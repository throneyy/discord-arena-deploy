// ─── Blockchain Listener ────────────────────────────────────────────────────
// Watches the USDT ERC-20 contract on Polygon via Alchemy WebSocket.
// On each Transfer event, checks if the recipient is a known deposit
// address and credits the user’s balance.

const { ethers }  = require('ethers');
const config      = require('../config');
const prisma      = require('../config/database');
const logger      = require('../utils/logger');

// Minimal ERC-20 ABI: only Transfer event + decimals()
const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function decimals() view returns (uint8)',
];

const RECONNECT_DELAY_MS  = 5_000;
const MAX_RECONNECT_TRIES = 10;

class BlockchainListener {
  constructor() {
    this.provider  = null;
    this.contract  = null;
    this.decimals  = 6; // USDT uses 6 decimals
    this.running   = false;
    this.reconnectCount = 0;
  }

  async start() {
    this.running = true;
    await this._connect();
  }

  async stop() {
    this.running = false;
    if (this.provider) {
      try { await this.provider.destroy(); } catch (_) {}
    }
    logger.info('BlockchainListener stopped');
  }

  async _connect() {
    logger.info('BlockchainListener: connecting to Alchemy WebSocket…');

    try {
      this.provider = new ethers.WebSocketProvider(config.blockchain.alchemyWsUrl);

      // Fetch decimals once
      const tempContract = new ethers.Contract(
        config.blockchain.usdtContractAddress,
        ERC20_ABI,
        this.provider
      );
      this.decimals = await tempContract.decimals();
      logger.info(`USDT decimals: ${this.decimals}`);

      this.contract = new ethers.Contract(
        config.blockchain.usdtContractAddress,
        ERC20_ABI,
        this.provider
      );

      // Listen for all Transfer events; filter by known deposit address in handler
      this.contract.on('Transfer', this._handleTransfer.bind(this));

      // Handle WebSocket drops
      this.provider.websocket.on('close', () => {
        logger.warn('WebSocket closed — scheduling reconnect…');
        this._scheduleReconnect();
      });

      this.reconnectCount = 0;
      logger.info('BlockchainListener: WebSocket connected and listening');
    } catch (err) {
      logger.error('BlockchainListener: connection error', { error: err.message });
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (!this.running) return;
    if (this.reconnectCount >= MAX_RECONNECT_TRIES) {
      logger.error('BlockchainListener: max reconnect attempts reached — giving up');
      return;
    }
    this.reconnectCount++;
    const delay = RECONNECT_DELAY_MS * this.reconnectCount;
    logger.info(`BlockchainListener: reconnecting in ${delay / 1000}s (attempt ${this.reconnectCount})`);
    setTimeout(() => this._connect(), delay);
  }

  async _handleTransfer(from, to, value, event) {
    const toAddr = to.toLowerCase();

    // Look up whether this address is a known deposit address
    const user = await prisma.user.findFirst({
      where: { depositAddress: { equals: toAddr, mode: 'insensitive' } },
    });

    if (!user) return; // Not our address

    const amount = parseFloat(ethers.formatUnits(value, this.decimals));
    const txHash = event.log?.transactionHash ?? 'unknown';

    logger.info(`Deposit detected: ${amount} USDT → ${toAddr} (user ${user.discordId}, tx ${txHash})`);

    // Check for duplicate tx
    const duplicate = await prisma.transaction.findFirst({
      where: { txHash },
    });
    if (duplicate) {
      logger.warn(`Duplicate tx ignored: ${txHash}`);
      return;
    }

    // Credit atomically
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data:  { balance: { increment: amount } },
      }),
      prisma.transaction.create({
        data: {
          userId: user.id,
          type:   'DEPOSIT',
          status: 'COMPLETED',
          amount,
          txHash,
          metadata: { from, to, raw: value.toString() },
        },
      }),
    ]);

    logger.info(`Credited $${amount} USDT to user ${user.discordId}`);
  }
}

module.exports = new BlockchainListener();
