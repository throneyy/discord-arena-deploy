// ─── Package Metadata ────────────────────────────────────────────────────────
// Reads name/version from package.json for logging or /health responses.

const path = require('path');
let _pkg = null;

function getPkg() {
  if (!_pkg) {
    _pkg = require(path.join(__dirname, '../../package.json'));
  }
  return _pkg;
}

module.exports = {
  get name()    { return getPkg().name; },
  get version() { return getPkg().version; },
};
