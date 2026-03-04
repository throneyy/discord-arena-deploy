// ─── Discord Bot Client ──────────────────────────────────────────────────────
// Initialises the discord.js v14 client, registers slash commands, and
// wires up event handlers.

const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const config    = require('../config');
const logger    = require('../utils/logger');
const { commands } = require('./commands');

// Event files
const readyEvent       = require('./events/ready');
const interactionEvent = require('./events/interactionCreate');

async function createBot() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
    ],
  });

  // ── Register Events ──
  client.once(readyEvent.name, (...args) => readyEvent.execute(...args));
  client.on(interactionEvent.name, (...args) => interactionEvent.execute(...args));

  // ── Deploy Slash Commands ──
  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  const commandData = commands.map((cmd) => cmd.toJSON());

  try {
    if (config.discord.guildId) {
      // Guild-scoped (instant, good for dev)
      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body: commandData }
      );
      logger.info(`Registered ${commandData.length} guild commands`);
    } else {
      // Global (takes ~1 hr to propagate)
      await rest.put(
        Routes.applicationCommands(config.discord.clientId),
        { body: commandData }
      );
      logger.info(`Registered ${commandData.length} global commands`);
    }
  } catch (err) {
    logger.error('Failed to register slash commands', { error: err.message });
  }

  // ── Login ──
  await client.login(config.discord.token);

  return client;
}

module.exports = { createBot };
