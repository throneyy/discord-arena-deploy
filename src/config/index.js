// ─── Config ──────────────────────────────────────────────────────────────────
// Reads environment variables and exposes them as a typed config object.
// Throws early if required vars are missing.

require('dotenv').config();

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

module.exports = {
  discord: {
    token:    required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId:  process.env.DISCORD_GUILD_ID || null,
  },
  database: {
    url: required('DATABASE_URL'),
  },
  blockchain: {
    alchemyWsUrl:         process.env.ALCHEMY_WS_URL || null,
    alchemyHttpUrl:       process.env.ALCHEMY_HTTP_URL || null,
    usdtContractAddress:  process.env.USDT_CONTRACT_ADDRESS || '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  },
  wallet: {
    hdMnemonic: required('HD_WALLET_MNEMONIC'),
  },
  gameServer: {
    hmacSecret:     required('GAME_SERVER_HMAC_SECRET'),
    providerApiUrl: process.env.SERVER_PROVIDER_API_URL || '',
    providerApiKey: process.env.SERVER_PROVIDER_API_KEY || '',
  },
  api: {
    port: parseInt(process.env.API_PORT || '3000', 10),
  },
  platform: {
    feePercent: parseFloat(process.env.PLATFORM_FEE_PERCENT || '5'),
  },
};
