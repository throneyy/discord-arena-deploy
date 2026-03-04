// ─── Blockchain Listener ─────────────────────────────────────────────────────
// Listens for USDT (ERC-20) Transfer events on Polygon via Alchemy WebSocket.
// When a transfer to a known deposit address is detected, credits the user.

const { ethers } = require('ethers');
const prisma = require('../config/database');
const config = require('../config');
const logger = require('../utils/logger');

const ERC20_TRANSFER_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

const USDT_DECIMALS = 6; // Polygon USDT uses 6 decimals

let provider = null;
let contract = null;

async function start() {
  if (!config.blockchain.alchemyWsUrl) {
    logger.warn('ALCHEMY_WS_URL not set — blockchain listener disabled');
    return;
  }

  provider = new ethers.WebSocketProvider(config.blockchain.alchemyWsUrl);
  contract = new ethers.Contract(
    config.blockchain.usdtContractAddress,
    ERC20_TRANSFER_ABI,
    provider
  );

  // Listen for all Transfer events, filter by known deposit addresses
  contract.on('Transfer', handleTransfer);

  provider.on('error', (err) => {
    logger.error('WebSocket provider error', { error: err.message });
  });

  logger.info('Blockchain listener started (Polygon USDT)');
}

async function stop() {
  if (contract) {
    contract.off('Transfer', handleTransfer);
  }
  if (provider) {
    await provider.destroy();
  }
  logger.info('Blockchain listener stopped');
}

async function handleTransfer(from, to, value, event) {
  const toAddress = to.toLowerCase();

  // Look up user by deposit address (case-insensitive)
  const user = await prisma.user.findFirst({
    where: {
      depositAddress: {
        equals: toAddress,
        mode: 'insensitive',
      },
    },
  });

  if (!user) return; // Not our address

  const amount = parseFloat(ethers.formatUnits(value, USDT_DECIMALS));
  const txHash = event.log?.transactionHash || event.transactionHash;

  logger.info(`Deposit detected: ${amount} USDT to ${toAddress} (user ${user.discordId})`, {
    txHash,
    from,
    to,
    amount,
  });

  // Idempotency: skip if we've already processed this tx
  const existing = await prisma.transaction.findFirst({
    where: { txHash },
  });
  if (existing) {
    logger.warn(`Duplicate deposit tx ignored: ${txHash}`);
    return;
  }

  // Credit user balance and record transaction atomically
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { balance: { increment: amount } },
    }),
    prisma.transaction.create({
      data: {
        userId: user.id,
        type: 'DEPOSIT',
        status: 'COMPLETED',
        amount,
        txHash,
        metadata: { from, to, rawValue: value.toString() },
      },
    }),
  ]);

  logger.info(`Credited ${amount} USDT to user ${user.discordId}`);
}

module.exports = { start, stop };
