// ─── Meta Utility ─────────────────────────────────────────────────────────────────
// Safely parses metadata stored as either JSON string or plain object.

/**
 * @param {string|object|null|undefined} metadata
 * @returns {object}
 */
function getMeta(metadata) {
  if (!metadata) return {};
  if (typeof metadata === 'object') return metadata;
  try {
    return JSON.parse(metadata);
  } catch (_) {
    return {};
  }
}

module.exports = { getMeta };
