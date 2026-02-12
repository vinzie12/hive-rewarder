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
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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
 * < 10,000 HP → x3
 * >= 10,000 HP → x1
 */
function getMultiplier(totalDelegationHP) {
  return totalDelegationHP < 10000 ? 3 : 1;
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
