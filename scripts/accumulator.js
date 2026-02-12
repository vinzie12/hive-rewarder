/**
 * accumulator.js
 * Core accumulation logic for hive-rewarder.
 *
 * 1. Reads payout_summary.json (output from Hive Vote Tool).
 * 2. Applies a global multiplier based on total delegation HP:
 *    - < 10,000 HP → x3
 *    - >= 10,000 HP → x1
 * 3. Updates individual delegator balances in delegator_balances.json.
 * 4. When a delegator's balance >= 1 HIVE, triggers SBI payout (1-HIVE chunks).
 * 5. Logs all SBI transactions to sbi_log.json.
 */

const { fetchRewards } = require('./fetch_rewards');
const { processSBIPayouts } = require('./send_sbi');
const { loadJSON, saveJSON, getMultiplier, formatHIVE, getTodayUTC, log } = require('./utils');

async function accumulate() {
  log('🚀 Starting reward accumulation...');

  // Step 1: Fetch and validate payout summary
  const payoutSummary = fetchRewards();
  const { date, total_delegation_hp, delegators } = payoutSummary;

  // Step 2: Calculate global multiplier
  const multiplier = getMultiplier(total_delegation_hp);
  log(`📊 Total Delegation: ${total_delegation_hp} HP`);
  log(`✖️  Global Multiplier: x${multiplier}`);

  // Step 3: Load existing balances
  const balances = loadJSON('delegator_balances.json', {});
  const today = getTodayUTC();

  // Step 4: Apply multiplier and accumulate balances
  log('\n📋 Processing delegator rewards:');
  log('─'.repeat(60));

  for (const delegator of delegators) {
    const { name, base_reward } = delegator;
    const adjustedReward = formatHIVE(base_reward * multiplier);

    // Initialize delegator entry if it doesn't exist
    if (!balances[name]) {
      balances[name] = {
        balance: 0,
        total_sent: 0,
        last_updated: today
      };
    }

    const previousBalance = balances[name].balance;
    balances[name].balance = formatHIVE(previousBalance + adjustedReward);
    balances[name].last_updated = today;

    log(`  @${name}: base=${base_reward} × ${multiplier} = +${adjustedReward} HIVE → balance: ${balances[name].balance} HIVE`);
  }

  log('─'.repeat(60));

  // Step 5: Save updated balances before SBI processing
  saveJSON('delegator_balances.json', balances);

  // Step 6: Process SBI payouts (sends 1-HIVE chunks where balance >= 1)
  log('\n💸 Checking SBI payout eligibility...');
  await processSBIPayouts();

  // Step 7: Summary
  const updatedBalances = loadJSON('delegator_balances.json', {});
  log('\n🎉 Accumulation complete!');
  log('─'.repeat(60));
  log(`📅 Date: ${date}`);
  log(`📊 Total Delegation: ${total_delegation_hp} HP`);
  log(`✖️  Multiplier: x${multiplier}`);
  log(`👥 Delegators processed: ${delegators.length}`);

  let totalBalance = 0;
  let totalSent = 0;
  for (const [name, data] of Object.entries(updatedBalances)) {
    totalBalance += data.balance;
    totalSent += data.total_sent;
  }
  log(`💰 Total outstanding balance: ${formatHIVE(totalBalance)} HIVE`);
  log(`📤 Total SBI sent (all time): ${formatHIVE(totalSent)} HIVE`);
  log('─'.repeat(60));
}

// Run if executed directly
if (require.main === module) {
  accumulate().catch((err) => {
    console.error('Unhandled error in accumulator:', err);
    process.exit(1);
  });
}

module.exports = { accumulate };
