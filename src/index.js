// ─── Application Entry Point ────────────────────────────────────────────────
// Boots all subsystems: Express API, Discord Bot, Blockchain Listener.

require('dotenv').config();

const logger             = require('./utils/logger');
const { startApiServer } = require('./api/server');
const { createBot }      = require('./bot');
const blockchainListener = require('./services/blockchainListener');

async function main() {
  logger.info('═══════════════════════════════════════');
  logger.info('  Discord Arena — Starting Up');
  logger.info('═══════════════════════════════════════');

  try {
    // 1. Start Express API (game server callbacks)
    startApiServer();
    logger.info('[1/3] Express API ✓');

    // 2. Start Discord Bot
    await createBot();
    logger.info('[2/3] Discord Bot ✓');

    // 3. Start Blockchain Listener
    await blockchainListener.start();
    logger.info('[3/3] Blockchain Listener ✓');

    logger.info('═══════════════════════════════════════');
    logger.info('  All systems online.');
    logger.info('═══════════════════════════════════════');
  } catch (err) {
    logger.error('Fatal startup error', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

// ── Graceful Shutdown ──
async function shutdown(signal) {
  logger.info(`Received ${signal} — shutting down gracefully`);
  await blockchainListener.stop();
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled promise rejection', { error: err?.message, stack: err?.stack });
});

main();
