// ─── Express API Server ──────────────────────────────────────────────────────
// Serves the game server callback endpoint.

const express = require('express');
const helmet  = require('helmet');
const config  = require('../config');
const logger  = require('../utils/logger');

const matchResultRouter = require('./routes/matchResult');

function startApiServer() {
  const app = express();

  // ── Security middleware ──
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));

  // ── Routes ──
  app.use('/api', matchResultRouter);

  // ── Health check ──
  app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  // ── 404 handler ──
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // ── Error handler ──
  app.use((err, _req, res, _next) => {
    logger.error('Unhandled API error', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  });

  const port = config.api.port;
  app.listen(port, () => logger.info(`Express API listening on :${port}`));

  return app;
}

module.exports = { startApiServer };
