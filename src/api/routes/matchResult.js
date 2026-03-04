// ─── POST /api/match-result ───────────────────────────────────────────────────
// Called by the SourceMod game server plugin after a match ends.
// Body: { matchId, winnerDiscordId, timestamp }
// Headers: X-Signature-Sha256: hmac-sha256 of raw body

const { Router } = require('express');
const verifyHmac = require('../middleware/verifyHmac');
const matchService = require('../../services/matchService');
const logger = require('../../utils/logger');

const router = Router();

router.post('/match-result', verifyHmac, async (req, res) => {
  const { matchId, winnerDiscordId, timestamp } = req.body;

  // Basic schema check
  if (!matchId || !winnerDiscordId || !timestamp) {
    return res.status(400).json({ error: 'Missing required fields: matchId, winnerDiscordId, timestamp' });
  }

  // Replay-protection: reject requests older than 5 minutes
  const age = Date.now() - Number(timestamp);
  if (age > 5 * 60 * 1000) {
    logger.warn(`Rejected stale match-result request (age: ${age}ms)`, { matchId });
    return res.status(400).json({ error: 'Request timestamp is too old' });
  }

  try {
    const result = await matchService.processResult(matchId, winnerDiscordId);
    logger.info('Match result processed', result);
    return res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('Failed to process match result', { error: err.message, matchId });
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
