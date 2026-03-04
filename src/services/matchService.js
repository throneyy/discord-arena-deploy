// ─── Match Service ────────────────────────────────────────────────────────────
// Handles challenge creation, acceptance, server provisioning, and result processing.
// All balance mutations use Prisma $transaction for atomicity.

const prisma  = require('../config/database');
const config  = require('../config');
const logger  = require('../utils/logger');
const { getMeta } = require('../utils/meta');

const PLATFORM_FEE = parseFloat(process.env.PLATFORM_FEE_PERCENT ?? '5') / 100;

// ───────────────────────────────────────────────────────────────────
// 1. CREATE CHALLENGE
// ───────────────────────────────────────────────────────────────────
async function createChallenge(discordId, stakeAmount, gameType = 'cs2') {
  const user = await prisma.user.findUnique({ where: { discordId } });
  if (!user) throw new Error('You are not registered. Use /register first.');

  if (parseFloat(user.balance) < stakeAmount) {
    throw new Error(`Insufficient balance. You have $${parseFloat(user.balance).toFixed(2)} USDT.`);
  }

  const [match] = await prisma.$transaction([
    prisma.match.create({
      data: {
        challengerId: user.id,
        stakeAmount,
        gameType,
        status: 'PENDING',
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data:  { balance: { decrement: stakeAmount } },
    }),
    prisma.transaction.create({
      data: {
        userId: user.id,
        type:   'STAKE',
        status: 'PENDING',
        amount: stakeAmount,
        metadata: { action: 'challenge_created' },
      },
    }),
  ]);

  logger.info(`Match created: ${match.id} by ${discordId} for $${stakeAmount}`);
  return match;
}

// ───────────────────────────────────────────────────────────────────
// 2. ACCEPT CHALLENGE
// ───────────────────────────────────────────────────────────────────
async function acceptChallenge(matchId, discordId) {
  const [match, user] = await Promise.all([
    prisma.match.findUnique({ where: { id: matchId } }),
    prisma.user.findUnique({ where: { discordId } }),
  ]);

  if (!match)            throw new Error(`Match ${matchId} not found.`);
  if (!user)             throw new Error('You are not registered. Use /register first.');
  if (match.status !== 'PENDING') throw new Error('This match is no longer open.');
  if (match.challengerId === user.id) throw new Error('You cannot accept your own challenge.');

  const stake = parseFloat(match.stakeAmount);
  if (parseFloat(user.balance) < stake) {
    throw new Error(`Insufficient balance. You have $${parseFloat(user.balance).toFixed(2)} USDT.`);
  }

  const [updated] = await prisma.$transaction([
    prisma.match.update({
      where: { id: matchId },
      data:  { opponentId: user.id, status: 'ACCEPTED' },
    }),
    prisma.user.update({
      where: { id: user.id },
      data:  { balance: { decrement: stake } },
    }),
    prisma.transaction.create({
      data: {
        userId: user.id,
        type:   'STAKE',
        status: 'PENDING',
        amount: stake,
        metadata: { action: 'challenge_accepted', matchId },
      },
    }),
  ]);

  logger.info(`Match ${matchId} accepted by ${discordId}`);
  return updated;
}

// ───────────────────────────────────────────────────────────────────
// 3. PROVISION SERVER
// ───────────────────────────────────────────────────────────────────
async function provisionServer(matchId) {
  const match = await prisma.match.findUnique({
    where:   { id: matchId },
    include: { challenger: true, opponent: true },
  });

  if (!match) throw new Error(`Match ${matchId} not found.`);
  if (match.status !== 'ACCEPTED') throw new Error('Match is not in ACCEPTED state.');

  const apiUrl = config.gameServer.apiUrl;
  const apiKey = config.gameServer.apiKey;

  let serverData;
  try {
    const response = await fetch(apiUrl, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
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
      throw new Error(`Server provider returned ${response.status}: ${text}`);
    }

    serverData = await response.json();
  } catch (err) {
    // Refund both players on provisioning failure
    const stake = parseFloat(match.stakeAmount);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: match.challengerId },
        data:  { balance: { increment: stake } },
      }),
      prisma.user.update({
        where: { id: match.opponentId },
        data:  { balance: { increment: stake } },
      }),
      prisma.match.update({
        where: { id: matchId },
        data:  { status: 'CANCELLED', metadata: { error: err.message } },
      }),
    ]);
    logger.error(`Server provisioning failed for match ${matchId}`, { error: err.message });
    throw err;
  }

  const updated = await prisma.match.update({
    where: { id: matchId },
    data:  {
      status:      'LIVE',
      serverApiId: serverData.id ?? serverData.serverId ?? 'unknown',
      metadata: {
        serverIp:   serverData.ip   ?? serverData.serverIp   ?? 'pending',
        serverPort: serverData.port ?? serverData.serverPort ?? 27015,
      },
    },
  });

  logger.info(`Match ${matchId} is now LIVE on server ${updated.serverApiId}`);
  return updated;
}

// ───────────────────────────────────────────────────────────────────
// 4. PROCESS RESULT  (called from Express route after HMAC verification)
// ───────────────────────────────────────────────────────────────────
async function processResult(matchId, winnerDiscordId) {
  const match = await prisma.match.findUnique({
    where:   { id: matchId },
    include: { challenger: true, opponent: true },
  });

  if (!match)                   throw new Error(`Match ${matchId} not found.`);
  if (match.status !== 'LIVE')  throw new Error('Match is not currently LIVE.');

  const winner = [match.challenger, match.opponent].find(
    (u) => u && u.discordId === winnerDiscordId
  );
  if (!winner) throw new Error(`${winnerDiscordId} is not a participant in match ${matchId}.`);

  const total     = parseFloat(match.stakeAmount) * 2;
  const fee       = parseFloat((total * PLATFORM_FEE).toFixed(6));
  const payout    = parseFloat((total - fee).toFixed(6));

  await prisma.$transaction([
    prisma.match.update({
      where: { id: matchId },
      data:  {
        status:       'COMPLETED',
        winnerId:     winner.id,
        payoutAmount: payout,
        feeAmount:    fee,
      },
    }),
    prisma.user.update({
      where: { id: winner.id },
      data:  { balance: { increment: payout } },
    }),
    prisma.transaction.create({
      data: {
        userId: winner.id,
        type:   'PAYOUT',
        status: 'COMPLETED',
        amount: payout,
        metadata: { matchId, fee, total },
      },
    }),
  ]);

  logger.info(`Match ${matchId} completed. Winner: ${winnerDiscordId}, payout: $${payout}`);
  return { matchId, winner: winnerDiscordId, payout, fee };
}

// ───────────────────────────────────────────────────────────────────
// 5. CANCEL MATCH
// ───────────────────────────────────────────────────────────────────
async function cancelMatch(matchId, discordId) {
  const [match, user] = await Promise.all([
    prisma.match.findUnique({ where: { id: matchId } }),
    prisma.user.findUnique({ where: { discordId } }),
  ]);

  if (!match) throw new Error(`Match ${matchId} not found.`);
  if (!user)  throw new Error('User not found.');
  if (match.challengerId !== user.id) throw new Error('Only the challenger can cancel this match.');
  if (match.status !== 'PENDING') throw new Error('Only PENDING matches can be cancelled.');

  await prisma.$transaction([
    prisma.match.update({
      where: { id: matchId },
      data:  { status: 'CANCELLED' },
    }),
    prisma.user.update({
      where: { id: user.id },
      data:  { balance: { increment: parseFloat(match.stakeAmount) } },
    }),
  ]);

  logger.info(`Match ${matchId} cancelled by ${discordId} — stake refunded`);
  return { matchId, status: 'CANCELLED' };
}

module.exports = { createChallenge, acceptChallenge, provisionServer, processResult, cancelMatch };
