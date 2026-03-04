// ─── Wallet Service ──────────────────────────────────────────────────────────
// Derives unique Polygon deposit addresses for each user using BIP-44 HD wallet.
// No private keys stored in the database — addresses are re-derived on demand.

const { ethers } = require('ethers');
const prisma = require('../config/database');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Get or create a deposit address for a Discord user.
 * Uses a BIP-44 path: m/44'/60'/0'/0/{index}
 */
async function getOrCreateDepositAddress(discordId, username) {
  // Check if user already exists
  const existing = await prisma.user.findUnique({
    where: { discordId },
  });

  if (existing) {
    return { address: existing.depositAddress, isNew: false };
  }

  // Find next available HD wallet index
  const lastUser = await prisma.user.findFirst({
    orderBy: { hdWalletIndex: 'desc' },
    select: { hdWalletIndex: true },
  });

  const nextIndex = lastUser ? lastUser.hdWalletIndex + 1 : 0;

  // Derive address from HD wallet
  const mnemonic   = ethers.Mnemonic.fromPhrase(config.wallet.hdMnemonic);
  const hdNode     = ethers.HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0`);
  const childWallet = hdNode.deriveChild(nextIndex);
  const address    = childWallet.address;

  // Create user record
  const user = await prisma.user.create({
    data: {
      discordId,
      username,
      depositAddress: address,
      hdWalletIndex: nextIndex,
    },
  });

  logger.info(`New user registered: ${discordId} -> ${address} (index ${nextIndex})`);

  return { address: user.depositAddress, isNew: true };
}

/**
 * Derive the private key for a deposit address (for sweeping funds).
 * Call this only when initiating a payout transaction.
 */
function derivePrivateKey(index) {
  const mnemonic   = ethers.Mnemonic.fromPhrase(config.wallet.hdMnemonic);
  const hdNode     = ethers.HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0`);
  const childWallet = hdNode.deriveChild(index);
  return childWallet.privateKey;
}

module.exports = { getOrCreateDepositAddress, derivePrivateKey };
