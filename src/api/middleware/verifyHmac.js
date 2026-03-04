// ─── HMAC-SHA256 Middleware ────────────────────────────────────────────────────
// Verifies the X-Signature-Sha256 header on incoming game-server requests.
// The signature is: hmac-sha256 of the raw request body, keyed with
// GAME_SERVER_HMAC_SECRET.

const crypto = require('crypto');
const config = require('../../config');
const logger = require('../../utils/logger');

/**
 * Express middleware — rejects requests with invalid or missing HMAC signatures.
 */
function verifyHmac(req, res, next) {
  const signature = req.headers['x-signature-sha256'];

  if (!signature) {
    logger.warn('Missing X-Signature-Sha256 header', { path: req.path });
    return res.status(401).json({ error: 'Missing signature header' });
  }

  const rawBody = req.rawBody;
  if (!rawBody) {
    logger.warn('No raw body available for HMAC verification');
    return res.status(400).json({ error: 'No body' });
  }

  const expected = crypto
    .createHmac('sha256', config.gameServer.hmacSecret)
    .update(rawBody)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  let valid = false;
  try {
    valid = crypto.timingSafeEqual(
      Buffer.from(signature,        'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch (_) {
    valid = false;
  }

  if (!valid) {
    logger.warn('Invalid HMAC signature', { path: req.path });
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

module.exports = verifyHmac;
