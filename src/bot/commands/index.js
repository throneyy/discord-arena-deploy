const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const walletService = require('../../services/walletService');
const matchService  = require('../../services/matchService');
const prisma        = require('../../config/database');
const logger        = require('../../utils/logger');

const commands = [
  new SlashCommandBuilder()
    .setName('register')
    .setDescription('Create your account and get a unique USDT deposit address.'),

  new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Check your current balance.'),

  new SlashCommandBuilder()
    .setName('deposit')
    .setDescription('Show your Polygon USDT deposit address.'),

  new SlashCommandBuilder()
    .setName('challenge')
    .setDescription('Create a new match challenge.')
    .addNumberOption(opt =>
      opt.setName('stake')
        .setDescription('Amount to stake (USDT)')
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(opt =>
      opt.setName('game')
        .setDescription('Game type')
        .setRequired(false)
        .addChoices(
          { name: 'Counter-Strike 2', value: 'cs2' },
          { name: 'Team Fortress 2',  value: 'tf2' },
        )
    ),

  new SlashCommandBuilder()
    .setName('accept')
    .setDescription('Accept an open match challenge.')
    .addStringOption(opt =>
      opt.setName('match_id')
        .setDescription('The match ID to accept')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('cancel')
    .setDescription('Cancel your pending challenge.')
    .addStringOption(opt =>
      opt.setName('match_id')
        .setDescription('The match ID to cancel')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('matches')
    .setDescription('List your recent matches.'),
];

// ── All handlers receive an already-deferred interaction ──
// Just call interaction.editReply() — no need to deferReply().

const handlers = {
  async register(interaction) {
    const { address, isNew } = await walletService.getOrCreateDepositAddress(
      interaction.user.id,
      interaction.user.username
    );

    if (isNew) {
      await interaction.editReply({
        content: [
          '**Account Created**',
          `Your unique Polygon USDT deposit address:`,
          `\`${address}\``,
          '',
          '> Send USDT (Polygon) to this address to fund your account.',
          '> Deposits are detected automatically.',
        ].join('\n'),
      });
    } else {
      await interaction.editReply({
        content: `You're already registered. Your deposit address: \`${address}\``,
      });
    }
  },

  async balance(interaction) {
    const user = await prisma.user.findUnique({
      where: { discordId: interaction.user.id },
    });

    if (!user) {
      return interaction.editReply({ content: 'You are not registered. Use `/register` first.' });
    }

    await interaction.editReply({
      content: `**Your Balance:** $${parseFloat(user.balance).toFixed(2)} USDT`,
    });
  },

  async deposit(interaction) {
    const user = await prisma.user.findUnique({
      where: { discordId: interaction.user.id },
    });

    if (!user) {
      return interaction.editReply({ content: 'You are not registered. Use `/register` first.' });
    }

    await interaction.editReply({
      content: [
        '**Your Deposit Address (Polygon Network)**',
        `\`${user.depositAddress}\``,
        '',
        '> Send **USDT** on the **Polygon** network only.',
        '> Deposits are credited automatically within ~30 seconds.',
      ].join('\n'),
    });
  },

  async challenge(interaction) {
    const stake    = interaction.options.getNumber('stake');
    const gameType = interaction.options.getString('game') || 'cs2';

    const match = await matchService.createChallenge(
      interaction.user.id,
      stake,
      gameType
    );

    await interaction.editReply({
      content: [
        `**New Challenge Created**`,
        `Match ID: \`${match.id}\``,
        `Stake: **$${stake} USDT**`,
        `Game: **${gameType.toUpperCase()}**`,
        '',
        `> Anyone can accept with \`/accept match_id:${match.id}\``,
      ].join('\n'),
    });
  },

  async accept(interaction) {
    const matchId = interaction.options.getString('match_id');
    const match = await matchService.acceptChallenge(matchId, interaction.user.id);

    await interaction.editReply({
      content: [
        `**Challenge Accepted**`,
        `Match ID: \`${match.id}\``,
        `Stake: **$${parseFloat(match.stakeAmount).toFixed(2)} USDT** each`,
        `Total Pool: **$${(parseFloat(match.stakeAmount) * 2).toFixed(2)} USDT**`,
        '',
        '> Provisioning game server...',
      ].join('\n'),
    });

    // Provision server in the background
    try {
      const provisioned = await matchService.provisionServer(matchId);
      const meta = typeof provisioned.metadata === 'string'
        ? JSON.parse(provisioned.metadata)
        : provisioned.metadata || {};

      await interaction.followUp({
        content: [
          `**Server Ready**`,
          `Connect: \`${meta.serverIp}:${meta.serverPort}\``,
          `Match ID: \`${matchId}\``,
          '',
          '> Good luck. Winner takes the pot (minus 5% platform fee).',
        ].join('\n'),
      });
    } catch (provisionErr) {
      await interaction.followUp({
        content: `Server provisioning failed - stakes have been refunded. Error: ${provisionErr.message}`,
      });
    }
  },

  async cancel(interaction) {
    const matchId = interaction.options.getString('match_id');
    await matchService.cancelMatch(matchId, interaction.user.id);

    await interaction.editReply({
      content: `Match \`${matchId}\` has been cancelled.`,
    });
  },

  async matches(interaction) {
    const user = await prisma.user.findUnique({
      where: { discordId: interaction.user.id },
    });

    if (!user) {
      return interaction.editReply({ content: 'You are not registered. Use `/register` first.' });
    }

    const recentMatches = await prisma.match.findMany({
      where: {
        OR: [
          { challengerId: user.id },
          { opponentId: user.id },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { challenger: true, opponent: true, winner: true },
    });

    if (recentMatches.length === 0) {
      return interaction.editReply({ content: 'No matches found.' });
    }

    const lines = recentMatches.map((m) => {
      const won = m.winnerId === user.id ? '✅' : m.winnerId ? '❌' : '⏳';
      const stake = parseFloat(m.stakeAmount).toFixed(2);
      return `${won} \`${m.id.slice(0, 8)}\` - $${stake} - ${m.status} - ${m.gameType}`;
    });

    await interaction.editReply({
      content: `**Your Recent Matches**\n${lines.join('\n')}`,
    });
  },
};

module.exports = { commands, handlers };
