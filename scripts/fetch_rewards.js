/**
 * fetch_rewards.js
 * Reads the Hive Vote Tool output (payout_summary.json) and validates it.
 * In a production setup, this script could fetch data from the Hive blockchain
 * or an external API. For now, it reads and validates the local JSON file.
 */

const { loadJSON, log } = require('./utils');

function fetchRewards() {
  log('📥 Fetching payout summary from Hive Vote Tool output...');

  const payoutSummary = loadJSON('payout_summary.json', null);

  if (!payoutSummary) {
    console.error('❌ payout_summary.json is missing or invalid. Cannot proceed.');
    process.exit(1);
  }

  // Validate required fields
  if (!payoutSummary.date) {
    console.error('❌ payout_summary.json is missing "date" field.');
    process.exit(1);
  }

  if (typeof payoutSummary.total_delegation_hp !== 'number') {
    console.error('❌ payout_summary.json is missing or invalid "total_delegation_hp" field.');
    process.exit(1);
  }

  if (!Array.isArray(payoutSummary.delegators) || payoutSummary.delegators.length === 0) {
    console.error('❌ payout_summary.json has no delegators.');
    process.exit(1);
  }

  // Validate each delegator entry
  for (const d of payoutSummary.delegators) {
    if (!d.name || typeof d.base_reward !== 'number') {
      console.error(`❌ Invalid delegator entry: ${JSON.stringify(d)}`);
      process.exit(1);
    }
  }

  log(`✅ Payout summary loaded for date: ${payoutSummary.date}`);
  log(`📊 Total delegation: ${payoutSummary.total_delegation_hp} HP`);
  log(`👥 Delegators found: ${payoutSummary.delegators.length}`);

  return payoutSummary;
}

// Run if executed directly
if (require.main === module) {
  const summary = fetchRewards();
  console.log('\n📋 Payout Summary:');
  console.log(JSON.stringify(summary, null, 2));
}

module.exports = { fetchRewards };
