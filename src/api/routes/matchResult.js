// ─── Match Result Route ──────────────────────────────────────────────────────
// POST /api/match-result
// Called by the SourceMod plugin after each match ends.
// Protected by HMAC-SHA256 signature verification.

const express     = require('express');
const verifyHmac  = require('../middleware/verifyHmac');
const matchService = require('../../services/matchService');
const logger      = require('../../utils/logger');

const router = express.Router();

/**
 * POST /api/match-result
 * Body: { matchId, winnerDiscordId, timestamp }
 * Headers: x-signature: <HMAC-SHA256 hex>
 */
router.post('/match-result', verifyHmac, async (req, res) => {
  const { matchId, winnerDiscordId } = req.body;

  if (!matchId || !winnerDiscordId) {
    return res.status(400).json({ error: 'matchId and winnerDiscordId are required' });
  }

  logger.info(`Match result received: match=${matchId}, winner=${winnerDiscordId}`);

  try {
    const result = await matchService.processResult(matchId, winnerDiscordId);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('Failed to process match result', { error: err.message, matchId });

    const status = err.message.includes('not found') ? 404
      : err.message.includes('not LIVE')             ? 409
      : 500;

    return res.status(status).json({ error: err.message });
  }
});

module.exports = router;
