# Discord Arena

Automated Discord gambling/matchmaking platform with blockchain deposits, game server integration, and escrow-based payouts.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Discord Arena                            │
├─────────────┬──────────────┬──────────────┬────────────────────┤
│  Discord    │  Express     │  Blockchain  │  Game Server       │
│  Bot (v14)  │  API (:3000) │  Listener    │  Bridge            │
│             │              │              │                    │
│  /register  │  POST /api/  │  Alchemy WS  │  SourceMod .sp     │
│  /balance   │  match-result│  → USDT on   │  → HMAC-signed     │
│  /deposit   │  (HMAC auth) │    Polygon   │    result POST     │
│  /challenge │              │  → auto      │                    │
│  /accept    │              │    credit    │                    │
│  /cancel    │              │              │                    │
│  /matches   │              │              │                    │
└─────────┬───┴──────┬───────┴──────┬───────┴────────────────────┘
          │          │              │
          └──────────┴──────────────┘
                     │
              ┌──────┴──────┐
              │  PostgreSQL  │
              │  (Railway)   │
              │              │
              │  Users       │
              │  Transactions│
              │  Matches     │
              └─────────────┘
```

## Project Structure

```
discord-arena/
├── prisma/
│   └── schema.prisma           # Database schema (Users, Transactions, Matches)
├── src/
│   ├── index.js                # Entry point — boots all subsystems
│   ├── config/
│   │   ├── index.js            # Environment config loader
│   │   └── database.js         # Prisma client singleton
│   ├── bot/
│   │   ├── index.js            # Discord.js client + command registration
│   │   ├── commands/
│   │   │   └── index.js        # All slash command definitions + handlers
│   │   └── events/
│   │       ├── ready.js        # Bot online event
│   │       └── interactionCreate.js  # Command router
│   ├── services/
│   │   ├── walletService.js    # HD wallet derivation (BIP-44)
│   │   ├── blockchainListener.js  # USDT deposit detection on Polygon
│   │   └── matchService.js     # Staking, escrow, provisioning, payout
│   ├── api/
│   │   ├── server.js           # Express server setup
│   │   ├── routes/
│   │   │   └── matchResult.js  # POST /api/match-result endpoint
│   │   └── middleware/
│   │       └── verifyHmac.js   # HMAC-SHA256 signature verification
│   └── utils/
│       └── logger.js           # Winston logger
├── gameserver/
│   ├── discord_arena.sp        # SourceMod Pawn plugin
│   └── discord_arena.cfg       # Server-side config
├── .env.example                # Environment variable template
├── .gitignore
├── Dockerfile                  # Container build for Railway
├── railway.toml                # Railway deployment config
└── package.json
```

## Setup

### 1. Prerequisites

- Node.js 18+
- PostgreSQL database (Railway provision)
- Discord Application with Bot token ([Developer Portal](https://discord.com/developers/applications))
- Alchemy account with Polygon WebSocket endpoint
- HD wallet mnemonic (12 or 24 words)

### 2. Environment Variables

Copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | Application ID |
| `DISCORD_GUILD_ID` | Your server ID (for dev; remove for global) |
| `DATABASE_URL` | PostgreSQL connection string |
| `ALCHEMY_WS_URL` | Alchemy Polygon WebSocket URL |
| `HD_WALLET_MNEMONIC` | BIP-39 mnemonic for HD wallet |
| `GAME_SERVER_HMAC_SECRET` | Shared secret with game servers |
| `SERVER_PROVIDER_API_URL` | Game server provider REST API |
| `SERVER_PROVIDER_API_KEY` | API key for server provider |

### 3. Local Development

```bash
npm install
npx prisma db push      # Create/update tables
npm run dev              # Start with nodemon
```

### 4. Deploy to Railway

```bash
# Connect your repo to Railway, then:
railway up
```

Railway auto-detects the `Dockerfile` and `railway.toml`. Add your environment variables in the Railway dashboard. The start command runs `prisma db push` on every deploy.

## Flow

### Deposit Flow
1. User runs `/register` → HD wallet derives unique Polygon address
2. User sends USDT to that address on Polygon network
3. Blockchain listener detects the ERC-20 Transfer event
4. Balance credited atomically in PostgreSQL

### Match Flow
1. Player A runs `/challenge stake:25` → Match created (PENDING)
2. Player B runs `/accept match_id:xxx` → Both balances deducted (escrow)
3. Game server provisioned via REST API → Match goes LIVE
4. SourceMod plugin detects round/map end → POSTs result with HMAC
5. Express API validates HMAC → `matchService.processResult()`
6. Winner receives `Total × 0.95`, platform keeps 5% fee

### Security
- All game server → API communication signed with HMAC-SHA256
- Replay protection: requests must include timestamp within 5 minutes
- Constant-time signature comparison prevents timing attacks
- Deposit addresses are deterministic (HD wallet) — no private keys stored in DB
- All balance operations use Prisma `$transaction` for atomicity
- Decimal type avoids floating-point rounding errors

## SourceMod Setup

1. Install [sm-ripext](https://github.com/ErikMinekus/sm-ripext) on your game server
2. Compile `gameserver/discord_arena.sp` with `spcomp`
3. Place the compiled `.smx` in `addons/sourcemod/plugins/`
4. Copy `discord_arena.cfg` to `cfg/sourcemod/`
5. Set the HMAC secret and API URL in the config
6. Before each match, set the match ID via RCON:
   ```
   rcon da_match_id "clxxxxxxxxxxxxxxxxxx"
   ```

## License

MIT
