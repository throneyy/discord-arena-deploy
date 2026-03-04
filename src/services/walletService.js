// ─── HD Wallet Service ───────────────────────────────────────────────────────
// Derives unique deposit addresses from a single mnemonic using BIP-44 path:
//   m/44'/60'/0'/0/{index}
// Each user gets a deterministic address tied to their hdWalletIndex.

const { ethers } = require('ethers');
const config     = require('../config');
const prisma     = require('../config/database');
const logger     = require('../utils/logger');

class WalletService {
  constructor() {
    this.hdNode = ethers.HDNodeWallet.fromPhrase(
      config.blockchain.hdMnemonic,
      undefined,                        // no password
      "m/44'/60'/0'/0"                  // BIP-44 base path for Ethereum
    );
    logger.info('WalletService initialised — HD node ready');
  }

  /**
   * Derive the wallet for a given index.
   * @param {number} index
   * @returns {{ address: string, privateKey: string }}
   */
  deriveWallet(index) {
    const child = this.hdNode.deriveChild(index);
    return {
      address:    child.address,
      privateKey: child.privateKey,
    };
  }

  /**
   * Get (or create) a deposit address for a Discord user.
   * Atomically claims the next available HD index.
   * @param {string} discordId
   * @param {string} username
   * @returns {{ address: string, isNew: boolean }}
   */
  async getOrCreateDepositAddress(discordId, username) {
    // Already registered?
    const existing = await prisma.user.findUnique({ where: { discordId } });
    if (existing) {
      return { address: existing.depositAddress, isNew: false };
    }

    // Claim the next index atomically
    const maxResult = await prisma.user.aggregate({
      _max: { hdWalletIndex: true },
    });
    const nextIndex = (maxResult._max.hdWalletIndex ?? -1) + 1;

    const { address } = this.deriveWallet(nextIndex);

    const user = await prisma.user.create({
      data: {
        discordId,
        username,
        depositAddress: address,
        hdWalletIndex:  nextIndex,
      },
    });

    logger.info(`New user registered: ${discordId} → ${address} (index ${nextIndex})`);
    return { address: user.depositAddress, isNew: true };
  }
}

module.exports = new WalletService();
