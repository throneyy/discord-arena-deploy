// ─── Express API Server ────────────────────────────────────────────────────
// Listens for game server callbacks (HMAC-authenticated).

const express      = require('express');
const helmet       = require('helmet');
const config       = require('../config');
const logger       = require('../utils/logger');
const matchResult  = require('./routes/matchResult');

function startApiServer() {
  const app = express();

  // ── Middleware ──
  app.use(helmet());

  // Parse JSON bodies (raw body needed for HMAC — see verifyHmac.js)
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    })
  );

  // ── Routes ──
  app.use('/api', matchResult);

  // ── Health check ──
  app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

  // ── Error handler ──
  app.use((err, _req, res, _next) => {
    logger.error('Unhandled Express error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  });

  const port = config.api.port;
  app.listen(port, () => {
    logger.info(`Express API listening on :${port}`);
  });

  return app;
}

module.exports = { startApiServer };
