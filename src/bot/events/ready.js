// ─── Ready Event ─────────────────────────────────────────────────────────────
// Fires once when the Discord bot successfully connects.

const logger = require('../../utils/logger');

module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    logger.info(`Discord bot online as ${client.user.tag}`);
    logger.info(`Serving ${client.guilds.cache.size} guild(s)`);
  },
};
