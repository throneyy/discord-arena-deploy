// ─── HMAC Verification Middleware ────────────────────────────────────────────
// Validates the x-signature header on incoming game server requests.
// Prevents spoofed match results.

const crypto = require('crypto');
const config = require('../../config');
const logger = require('../../utils/logger');

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Expected header: x-signature: <hex HMAC-SHA256>
 * Signature covers: JSON.stringify(req.body)
 */
module.exports = function verifyHmac(req, res, next) {
  const signature = req.headers['x-signature'];

  if (!signature) {
    logger.warn('Missing x-signature header');
    return res.status(401).json({ error: 'Missing signature' });
  }

  // Replay protection: require timestamp in body within 5 minutes
  const timestamp = req.body?.timestamp;
  if (!timestamp) {
    return res.status(400).json({ error: 'Missing timestamp in request body' });
  }

  const now = Date.now();
  const reqTime = parseInt(timestamp, 10);
  if (isNaN(reqTime) || Math.abs(now - reqTime) > MAX_TIMESTAMP_SKEW_MS) {
    logger.warn(`Request timestamp out of window: ${timestamp}`);
    return res.status(401).json({ error: 'Request timestamp expired or invalid' });
  }

  // Compute expected HMAC over raw JSON body
  const rawBody = JSON.stringify(req.body);
  const expected = crypto
    .createHmac('sha256', config.gameServer.hmacSecret)
    .update(rawBody)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    const sigBuf = Buffer.from(signature,  'hex');
    const expBuf = Buffer.from(expected, 'hex');

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      logger.warn('Invalid HMAC signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } catch {
    return res.status(401).json({ error: 'Invalid signature format' });
  }

  next();
};
