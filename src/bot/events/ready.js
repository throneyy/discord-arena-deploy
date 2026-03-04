// ─── Ready Event ─────────────────────────────────────────────────────────────
// Fires once when the Discord bot successfully connects.

const logger = require('../../utils/logger');

module.exports = {
  name: 'ready',
  once: true,
  async execute(client) {
    logger.info(`Discord bot online as ${client.user.tag}`);
    logger.info(`Serving ${client.guilds.cache.size} guild(s)`);

    // Post startup message to the main channel
    try {
      const channel = await client.channels.fetch('1418477778805723163');
      if (channel) {
        await channel.send('**Discord Arena Bot is LIVE on Railway** -- all systems online.');
      }
    } catch (err) {
      logger.warn('Could not send startup message', { error: err.message });
    }
  },
};
