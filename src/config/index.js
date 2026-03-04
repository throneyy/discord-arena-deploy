// ─── Config ───────────────────────────────────────────────────────────────────
// Centralised environment variable loader.
// Throws early with a clear error if any required var is missing.

require('dotenv').config();

function required(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

module.exports = {
  discord: {
    token:    required('DISCORD_TOKEN'),
    clientId: required('DISCORD_CLIENT_ID'),
    guildId:  process.env.DISCORD_GUILD_ID || null,   // optional
  },
  blockchain: {
    alchemyWsUrl:         required('ALCHEMY_WS_URL'),
    alchemyHttpUrl:       process.env.ALCHEMY_HTTP_URL || null,
    hdMnemonic:           required('HD_WALLET_MNEMONIC'),
    usdtContractAddress:  required('USDT_CONTRACT_ADDRESS'),
  },
  gameServer: {
    hmacSecret: required('GAME_SERVER_HMAC_SECRET'),
    apiUrl:     required('SERVER_PROVIDER_API_URL'),
    apiKey:     required('SERVER_PROVIDER_API_KEY'),
  },
  api: {
    port: parseInt(process.env.API_PORT || '3000', 10),
  },
};
