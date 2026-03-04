module.exports = {
  name: 'ready',
  execute(client) {
    const logger = require('../../utils/logger');
    logger.info(`Bot online as ${client.user.tag}`);
  },
};
