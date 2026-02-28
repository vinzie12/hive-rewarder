const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

/**
 * Get today's date in YYYY-MM-DD format (UTC).
 */
function getTodayUTC() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Load a JSON file from the data directory.
 * Returns parsed object or a fallback default.
 */
function loadJSON(filename, fallback) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️ ${filename} not found, using fallback.`);
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, ''));
  } catch (err) {
    console.error(`❌ Error reading ${filename}:`, err.message);
    return fallback;
  }
}

/**
 * Save a JSON object to the data directory.
 */
function saveJSON(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`💾 Saved ${filename}`);
}

/**
 * Determine global multiplier based on total delegation HP.
 * < 10,000 HP → 3.0
 * 10,000–20,000 HP → linearly 3.0 → 2.0
 * 20,000–30,000 HP → linearly 2.0 → 1.0
 * 30,000–40,000 HP → linearly 1.0 → 0.5
 * >= 40,000 HP → 0.5
 */
function getMultiplier(totalDelegationHP) {
  const totalHP = Number(totalDelegationHP) || 0;

  let m;
  if (totalHP < 10000) {
    m = 3.0;
  } else if (totalHP < 20000) {
    // 3.0 down to 2.0
    m = 3 - ((totalHP - 10000) / 10000);
  } else if (totalHP < 30000) {
    // 2.0 down to 1.0
    m = 2 - ((totalHP - 20000) / 10000);
  } else if (totalHP < 40000) {
    // 1.0 down to 0.5
    m = 1 - ((totalHP - 30000) / 10000) * 0.5;
  } else {
    m = 0.5;
  }

  // Clamp and round
  m = Math.max(0.5, m);
  return parseFloat(m.toFixed(3));
}

/**
 * Format a number to fixed decimal places.
 */
function formatHIVE(amount, decimals = 3) {
  return parseFloat(amount.toFixed(decimals));
}

/**
 * Log a message with a timestamp prefix.
 */
function log(message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

module.exports = {
  DATA_DIR,
  getTodayUTC,
  loadJSON,
  saveJSON,
  getMultiplier,
  formatHIVE,
  log
};
