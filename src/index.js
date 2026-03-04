// ─── Application Entry Point ─────────────────────────────────────────────────
// Boots all subsystems: Express API, Discord Bot, Blockchain Listener.

// Catch any uncaught errors before anything else
process.on('uncaughtException', (err) => {
  console.error('[BOOT] UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[BOOT] UNHANDLED REJECTION:', err);
});

console.log('[BOOT] Loading dotenv...');
require('dotenv').config();

console.log('[BOOT] Loading modules...');
const logger             = require('./utils/logger');
const { startApiServer } = require('./api/server');
const { createBot }      = require('./bot');
const blockchainListener = require('./services/blockchainListener');
console.log('[BOOT] All modules loaded.');

async function main() {
  console.log('[BOOT] main() called');
  logger.info('=======================================');
  logger.info('  Discord Arena -- Starting Up');
  logger.info('=======================================');

  try {
    // 1. Start Express API (game server callbacks)
    console.log('[BOOT] Starting Express API...');
    startApiServer();
    logger.info('[1/3] Express API OK');

    // 2. Start Discord Bot
    console.log('[BOOT] Starting Discord Bot...');
    await createBot();
    logger.info('[2/3] Discord Bot OK');

    // 3. Start Blockchain Listener
    console.log('[BOOT] Starting Blockchain Listener...');
    await blockchainListener.start();
    logger.info('[3/3] Blockchain Listener OK');

    logger.info('=======================================');
    logger.info('  All systems online.');
    logger.info('=======================================');
    console.log('[BOOT] Startup complete!');
  } catch (err) {
    console.error('[BOOT] FATAL ERROR:', err);
    logger.error('Fatal startup error', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

// ── Graceful Shutdown ──
async function shutdown(signal) {
  console.log(`[SHUTDOWN] Received ${signal}`);
  await blockchainListener.stop();
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main();
