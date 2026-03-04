// ─── Match Service ───────────────────────────────────────────────────────────
// Handles match lifecycle: create, accept (escrow), provision server, resolve.

const prisma  = require('../config/database');
const config  = require('../config');
const logger  = require('../utils/logger');

// ── Constants ──
const PLATFORM_FEE = config.platform.feePercent / 100; // e.g. 0.05

// ─────────────────────────────────────────────────────────────────────────────
// createChallenge
// ─────────────────────────────────────────────────────────────────────────────
async function createChallenge(discordId, stakeAmount, gameType = 'cs2') {
  // 1. Resolve user
  const user = await prisma.user.findUnique({ where: { discordId } });
  if (!user) throw new Error('You must register first (/register).');

  // 2. Check balance
  const balance = parseFloat(user.balance);
  if (balance < stakeAmount) {
    throw new Error(`Insufficient balance. You have $${balance.toFixed(2)} USDT.`);
  }

  // 3. Deduct stake + create match atomically
  const [, match] = await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data:  { balance: { decrement: stakeAmount } },
    }),
    prisma.match.create({
      data: {
        challengerId: user.id,
        stakeAmount,
        gameType,
        status: 'PENDING',
      },
    }),
    prisma.transaction.create({
      data: {
        userId: user.id,
        type:   'STAKE',
        status: 'COMPLETED',
        amount: stakeAmount,
      },
    }),
  ]);

  logger.info(`Match created: ${match.id} by ${discordId} (stake: $${stakeAmount})`);
  return match;
}

// ─────────────────────────────────────────────────────────────────────────────
// acceptChallenge
// ─────────────────────────────────────────────────────────────────────────────
async function acceptChallenge(matchId, discordId) {
  // 1. Load match
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { challenger: true },
  });

  if (!match)                        throw new Error(`Match ${matchId} not found.`);
  if (match.status !== 'PENDING')    throw new Error(`Match is not open (status: ${match.status}).`);
  if (match.challenger.discordId === discordId) throw new Error('You cannot accept your own challenge.');

  // 2. Resolve opponent
  const opponent = await prisma.user.findUnique({ where: { discordId } });
  if (!opponent) throw new Error('You must register first (/register).');

  const stake = parseFloat(match.stakeAmount);
  if (parseFloat(opponent.balance) < stake) {
    throw new Error(`Insufficient balance. You have $${parseFloat(opponent.balance).toFixed(2)} USDT.`);
  }

  // 3. Deduct opponent stake + mark match ACCEPTED atomically
  const [, updatedMatch] = await prisma.$transaction([
    prisma.user.update({
      where: { id: opponent.id },
      data:  { balance: { decrement: stake } },
    }),
    prisma.match.update({
      where: { id: matchId },
      data:  { opponentId: opponent.id, status: 'ACCEPTED' },
    }),
    prisma.transaction.create({
      data: {
        userId: opponent.id,
        type:   'STAKE',
        status: 'COMPLETED',
        amount: stake,
      },
    }),
  ]);

  logger.info(`Match ${matchId} accepted by ${discordId}`);
  return updatedMatch;
}

// ─────────────────────────────────────────────────────────────────────────────
// provisionServer
// ─────────────────────────────────────────────────────────────────────────────
async function provisionServer(matchId) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { challenger: true, opponent: true },
  });

  if (!match || match.status !== 'ACCEPTED') {
    throw new Error('Match must be in ACCEPTED state to provision a server.');
  }

  // Call game server provider API
  const response = await fetch(config.gameServer.providerApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${config.gameServer.providerApiKey}`,
    },
    body: JSON.stringify({
      game:    match.gameType,
      matchId: match.id,
      players: [
        match.challenger.discordId,
        match.opponent?.discordId,
      ].filter(Boolean),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    // Refund both players if provisioning fails
    await refundMatch(matchId, 'Server provisioning failed');
    throw new Error(`Server provider error ${response.status}: ${text}`);
  }

  const serverData = await response.json();

  // Update match with server info
  const updatedMatch = await prisma.match.update({
    where: { id: matchId },
    data: {
      status:      'LIVE',
      serverApiId: serverData.id,
      metadata: {
        serverIp:   serverData.ip,
        serverPort: serverData.port,
        serverId:   serverData.id,
      },
    },
  });

  logger.info(`Server provisioned for match ${matchId}: ${serverData.ip}:${serverData.port}`);
  return updatedMatch;
}

// ─────────────────────────────────────────────────────────────────────────────
// processResult  (called by Express API after HMAC verification)
// ─────────────────────────────────────────────────────────────────────────────
async function processResult(matchId, winnerDiscordId) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { challenger: true, opponent: true },
  });

  if (!match)             throw new Error(`Match ${matchId} not found.`);
  if (match.status !== 'LIVE') throw new Error(`Match is not LIVE (status: ${match.status}).`);

  // Validate winner
  const isChallenger = match.challenger.discordId === winnerDiscordId;
  const isOpponent   = match.opponent?.discordId  === winnerDiscordId;

  if (!isChallenger && !isOpponent) {
    throw new Error(`${winnerDiscordId} is not a participant in match ${matchId}.`);
  }

  const winnerId   = isChallenger ? match.challengerId : match.opponentId;
  const totalPot   = parseFloat(match.stakeAmount) * 2;
  const fee        = parseFloat((totalPot * PLATFORM_FEE).toFixed(6));
  const payout     = parseFloat((totalPot - fee).toFixed(6));

  // Credit winner + record fee transaction atomically
  await prisma.$transaction([
    prisma.user.update({
      where: { id: winnerId },
      data:  { balance: { increment: payout } },
    }),
    prisma.match.update({
      where: { id: matchId },
      data: {
        status:      'COMPLETED',
        winnerId,
        payoutAmount: payout,
        feeAmount:   fee,
      },
    }),
    prisma.transaction.create({
      data: {
        userId: winnerId,
        type:   'PAYOUT',
        status: 'COMPLETED',
        amount: payout,
        metadata: { matchId, fee, totalPot },
      },
    }),
  ]);

  logger.info(`Match ${matchId} resolved. Winner: ${winnerDiscordId}, payout: $${payout}`);
  return { matchId, winnerId, payout, fee };
}

// ─────────────────────────────────────────────────────────────────────────────
// cancelMatch
// ─────────────────────────────────────────────────────────────────────────────
async function cancelMatch(matchId, discordId) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { challenger: true },
  });

  if (!match) throw new Error(`Match ${matchId} not found.`);
  if (match.challenger.discordId !== discordId) throw new Error('Only the challenger can cancel.');
  if (match.status !== 'PENDING') throw new Error(`Cannot cancel a match with status: ${match.status}.`);

  const stake = parseFloat(match.stakeAmount);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: match.challengerId },
      data:  { balance: { increment: stake } },
    }),
    prisma.match.update({
      where: { id: matchId },
      data:  { status: 'CANCELLED' },
    }),
  ]);

  logger.info(`Match ${matchId} cancelled by ${discordId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// refundMatch  (internal — used on provisioning failure)
// ─────────────────────────────────────────────────────────────────────────────
async function refundMatch(matchId, reason) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { challenger: true, opponent: true },
  });

  if (!match) return;

  const stake = parseFloat(match.stakeAmount);
  const ops   = [
    prisma.match.update({
      where: { id: matchId },
      data:  { status: 'REFUNDED', metadata: { refundReason: reason } },
    }),
    prisma.user.update({
      where: { id: match.challengerId },
      data:  { balance: { increment: stake } },
    }),
  ];

  if (match.opponentId) {
    ops.push(
      prisma.user.update({
        where: { id: match.opponentId },
        data:  { balance: { increment: stake } },
      })
    );
  }

  await prisma.$transaction(ops);
  logger.info(`Match ${matchId} refunded: ${reason}`);
}

module.exports = { createChallenge, acceptChallenge, provisionServer, processResult, cancelMatch };
