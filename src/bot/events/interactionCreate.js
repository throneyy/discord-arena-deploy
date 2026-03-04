const { MessageFlags } = require('discord.js');
const { handlers } = require('../commands');
const logger = require('../../utils/logger');

// Commands that should have public (non-ephemeral) replies
const PUBLIC_COMMANDS = new Set(['challenge', 'accept']);

module.exports = {
  name: 'interactionCreate',
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;

    const start = Date.now();
    logger.info(`Interaction received: /${interaction.commandName}`, {
      user: interaction.user.id,
      interactionId: interaction.id,
      timestamp: new Date().toISOString(),
    });

    const handler = handlers[interaction.commandName];
    if (!handler) {
      logger.warn(`Unknown command: ${interaction.commandName}`);
      try {
        await interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
      } catch (e) {
        logger.warn('Could not reply to unknown command', { error: e.message });
      }
      return;
    }

    // ── Defer IMMEDIATELY before any handler logic ──
    try {
      const isPublic = PUBLIC_COMMANDS.has(interaction.commandName);
      await interaction.deferReply({
        flags: isPublic ? undefined : MessageFlags.Ephemeral,
      });
      logger.info(`Deferred /${interaction.commandName} in ${Date.now() - start}ms`);
    } catch (deferErr) {
      logger.error(`Failed to defer /${interaction.commandName} after ${Date.now() - start}ms`, {
        error: deferErr.message,
        code: deferErr.code,
        status: deferErr.status,
        user: interaction.user.id,
      });
      return;
    }

    // ── Run the handler (interaction is already deferred) ──
    try {
      await handler(interaction);
      logger.info(`/${interaction.commandName} completed in ${Date.now() - start}ms`);
    } catch (err) {
      logger.error(`Command error: ${interaction.commandName}`, {
        error: err.message,
        stack: err.stack?.split('\n').slice(0, 3).join(' | '),
        user: interaction.user.id,
      });

      try {
        await interaction.editReply({
          content: `Something went wrong: ${err.message}`,
        });
      } catch (replyErr) {
        logger.warn('Could not send error reply', { error: replyErr.message });
      }
    }
  },
};
