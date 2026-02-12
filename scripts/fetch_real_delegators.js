/**
 * fetch_real_delegators.js
 *
 * Fetches real delegators for @bayanihive from the Hive blockchain
 * by scanning account history for delegate_vesting_shares operations.
 * Then fetches curation rewards and calculates each delegator's share.
 * Generates payout_summary.json and data/delegation_history.json.
 *
 * Based on the patterns from:
 *   - hive-vote/scripts/generate_delegation_history.js
 *   - hive-vote/scripts/payout.js
 *   - hive-delegation-roulette-main/generate_delegation_history.js
 */

const hive = require('@hiveio/hive-js');
const fs = require('fs');
const path = require('path');
const { saveJSON, getTodayUTC, log } = require('./utils');
const Database = require('better-sqlite3');

const ACCOUNT = process.env.HIVE_USER || 'bayanihive';
const DELEGATION_HISTORY_FILE = path.join(__dirname, '..', 'data', 'delegation_history.json');
const DB_PATH = path.join(__dirname, '..', 'data', 'sync.db');

const API_NODES = [
  'https://api.deathwing.me',
  'https://api.openhive.network',
  'https://api.hive.blog',
  'https://anyx.io',
  'https://hive.roelandp.nl',
  'https://rpc.ausbit.dev',
  'https://hived.emre.sh',
  'https://hive-api.arcange.eu',
  'https://api.c0ff33a.uk',
  'https://rpc.ecency.com',
  'https://techcoderx.com',
  'https://api.hive.blue',
  'https://rpc.mahdiyari.info',
  'https://herpc.dtools.dev',
];

// ─── Node Management ────────────────────────────────────────────────

async function pickWorkingNode() {
  for (const url of API_NODES) {
    hive.api.setOptions({ url });
    log(`🌐 Trying Hive API node: ${url}`);
    const test = await new Promise(resolve => {
      hive.api.getAccounts([ACCOUNT], (err, res) => {
        resolve(err || !res ? null : res);
      });
    });
    if (test) {
      log(`✅ Using Hive API: ${url}`);
      return;
    }
  }
  throw new Error('❌ No working Hive API found.');
}

// ─── Helpers ────────────────────────────────────────────────────────

function vestsToHP(vests, totalVestingFundHive, totalVestingShares) {
  return (vests * totalVestingFundHive) / totalVestingShares;
}

async function fetchGlobalProps() {
  return new Promise((resolve, reject) => {
    hive.api.getDynamicGlobalProperties((err, props) => {
      if (err) return reject(err);
      const totalVestingFundHive = parseFloat(props.total_vesting_fund_hive.split(' ')[0]);
      const totalVestingShares = parseFloat(props.total_vesting_shares.split(' ')[0]);
      resolve({ totalVestingFundHive, totalVestingShares });
    });
  });
}

// ─── SQLite Sync State ──────────────────────────────────────────────

function initSyncDB() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_index INTEGER
    );
    INSERT OR IGNORE INTO sync_state (id, last_index) VALUES (1, 0);
  `);
  log(`� Sync database initialized: ${DB_PATH}`);
  return db;
}

function getLastIndex(db) {
  const row = db.prepare('SELECT last_index FROM sync_state WHERE id = 1').get();
  return row && row.last_index != null ? row.last_index : 0;
}

function updateLastIndex(db, index) {
  db.prepare('UPDATE sync_state SET last_index = ? WHERE id = 1').run(index);
  log(`� Updated last processed index to: ${index}`);
}

// ─── Incremental Account History Sync ───────────────────────────────

async function syncAccountHistory(lastIndex) {
  const latestIndex = await new Promise((resolve, reject) => {
    hive.api.getAccountHistory(ACCOUNT, -1, 1, (err, res) => {
      if (err) return reject(err);
      resolve(res[0][0]);
    });
  });

  log(`📊 Latest blockchain index: ${latestIndex}`);
  log(`📊 Last processed index: ${lastIndex}`);

  if (latestIndex <= lastIndex) {
    log(`✅ No new operations. (latest: ${latestIndex}, last processed: ${lastIndex})`);
    return { newOperations: [], latestIndex, hasNew: false };
  }

  const newCount = latestIndex - lastIndex;
  log(`📦 ${newCount} new operation(s) to fetch (index ${lastIndex + 1} → ${latestIndex})`);

  const newOperations = [];
  const limit = 1000;
  let start = latestIndex;
  let fetchedCount = 0;

  while (true) {
    const batchSize = Math.min(limit, start - lastIndex);
    if (batchSize <= 0) break;

    log(`🔄 Fetching operations from index ${start} (limit: ${batchSize})`);

    const history = await new Promise((resolve, reject) => {
      hive.api.getAccountHistory(ACCOUNT, start, batchSize, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });

    if (!history || history.length === 0) {
      log(`✅ No more operations found`);
      break;
    }

    const filtered = history.filter(([idx]) => idx > lastIndex);
    newOperations.push(...filtered);
    fetchedCount += filtered.length;
    log(`📈 Fetched ${filtered.length} new operations (total: ${fetchedCount})`);

    const lowestFetchedIdx = history[0][0];
    if (lowestFetchedIdx <= lastIndex + 1) break;

    start = lowestFetchedIdx - 1;
    if (start <= lastIndex) break;

    if (history.length < batchSize) {
      log(`✅ Reached end of available history`);
      break;
    }
  }

  // Sort ascending by index and deduplicate
  newOperations.sort((a, b) => a[0] - b[0]);
  const seen = new Set();
  const deduped = newOperations.filter(([idx]) => {
    if (seen.has(idx)) return false;
    seen.add(idx);
    return true;
  });

  log(`📈 Total new operations fetched: ${deduped.length}`);
  return { newOperations: deduped, latestIndex, hasNew: true };
}

// ─── Build Delegation History ───────────────────────────────────────

function buildDelegationHistory(rawHistory, totalVestingFundHive, totalVestingShares) {
  log(`🔍 Processing ${rawHistory.length} operations for delegation events...`);

  const delegationEvents = [];

  for (const [, op] of rawHistory) {
    if (op.op[0] === 'delegate_vesting_shares') {
      const { delegator, delegatee, vesting_shares } = op.op[1];
      const timestamp = new Date(op.timestamp + 'Z').getTime();
      const totalVests = parseFloat(vesting_shares);

      if (delegatee === ACCOUNT) {
        const hp = vestsToHP(totalVests, totalVestingFundHive, totalVestingShares);
        delegationEvents.push({
          delegator,
          totalVests,
          hp: parseFloat(hp.toFixed(3)),
          timestamp,
          date: new Date(timestamp).toISOString().split('T')[0],
        });
      }
    }
  }

  // Sort events by timestamp
  delegationEvents.sort((a, b) => a.timestamp - b.timestamp);

  // Build delegation history with delta calculations
  const delegationHistory = {};

  for (const event of delegationEvents) {
    const { delegator, totalVests, hp, timestamp, date } = event;

    if (!delegationHistory[delegator]) {
      delegationHistory[delegator] = [];
    }

    const previousEvents = delegationHistory[delegator];
    const previousTotal = previousEvents.length > 0
      ? previousEvents[previousEvents.length - 1].totalVests
      : 0;

    const deltaVests = totalVests - previousTotal;

    if (Math.abs(deltaVests) > 0.000001) {
      delegationHistory[delegator].push({
        vests: deltaVests,
        totalVests,
        hp: parseFloat(hp.toFixed(3)),
        timestamp,
        date,
      });

      log(`📝 ${delegator}: ${deltaVests > 0 ? '+' : ''}${deltaVests.toFixed(6)} VESTS (Total: ${totalVests.toFixed(6)} VESTS, ${hp} HP) on ${date}`);
    }
  }

  return delegationHistory;
}

// ─── Load Existing Delegation History ───────────────────────────────

function loadExistingDelegationHistory() {
  if (fs.existsSync(DELEGATION_HISTORY_FILE)) {
    const data = JSON.parse(fs.readFileSync(DELEGATION_HISTORY_FILE, 'utf8'));
    log(`💾 Loaded existing delegation_history.json (${Object.keys(data).length} delegators)`);
    return data;
  }
  log(`⚠️ No existing delegation_history.json found, starting fresh`);
  return {};
}

// ─── Merge New Delegation Events ────────────────────────────────────

function mergeNewDelegationEvents(existingHistory, newOperations, totalVestingFundHive, totalVestingShares) {
  log(`🔍 Processing ${newOperations.length} new operations for delegation events...`);

  let newEventCount = 0;

  for (const [, op] of newOperations) {
    if (op.op[0] === 'delegate_vesting_shares') {
      const { delegator, delegatee, vesting_shares } = op.op[1];
      const timestamp = new Date(op.timestamp + 'Z').getTime();
      const totalVests = parseFloat(vesting_shares);

      if (delegatee === ACCOUNT) {
        const hp = vestsToHP(totalVests, totalVestingFundHive, totalVestingShares);

        if (!existingHistory[delegator]) {
          existingHistory[delegator] = [];
        }

        const previousEvents = existingHistory[delegator];
        const previousTotal = previousEvents.length > 0
          ? previousEvents[previousEvents.length - 1].totalVests
          : 0;

        const deltaVests = totalVests - previousTotal;
        const date = new Date(timestamp).toISOString().split('T')[0];

        if (Math.abs(deltaVests) > 0.000001) {
          existingHistory[delegator].push({
            vests: deltaVests,
            totalVests,
            hp: parseFloat(hp.toFixed(3)),
            timestamp,
            date,
          });
          newEventCount++;
          log(`📝 ${delegator}: ${deltaVests > 0 ? '+' : ''}${deltaVests.toFixed(6)} VESTS (Total: ${totalVests.toFixed(6)} VESTS, ${hp.toFixed(3)} HP) on ${date}`);
        }
      }
    }
  }

  log(`📝 Merged ${newEventCount} new delegation events`);
  return existingHistory;
}

// ─── Get Active Delegators from History ─────────────────────────────

function getActiveDelegators(delegationHistory) {
  const active = {};

  for (const [delegator, events] of Object.entries(delegationHistory)) {
    const latest = events[events.length - 1];
    // Only include delegators with a positive current delegation
    if (latest.totalVests > 0 && latest.hp > 0) {
      active[delegator] = latest.hp;
    }
  }

  return active;
}

// ─── Fetch Claimed Curation Rewards (last 24h) ─────────────────────

async function getCurationRewards(rawHistory, totalVestingFundHive, totalVestingShares) {
  const phTz = 'Asia/Manila';
  
  // Get current time in Manila timezone
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: phTz }));
  
  // Curation window: 8:00 AM yesterday to 8:00 AM today (Manila time)
  const end = new Date(now);
  end.setHours(8, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 1);
  
  // Convert Manila time to UTC by calculating the offset
  const utcNow = new Date();
  const manilaOffset = now.getTime() - utcNow.getTime();
  
  const fromTime = start.getTime() - manilaOffset;
  const toTime = end.getTime() - manilaOffset;

  log(`⏰ Curation window (Manila): ${start.toISOString().split('T')[0]} 08:00 → ${end.toISOString().split('T')[0]} 08:00`);
  log(`⏰ Curation window (UTC): ${new Date(fromTime).toISOString()} → ${new Date(toTime).toISOString()}`);

  let totalVests = 0;
  let claimCount = 0;

  for (const [, op] of rawHistory) {
    const { timestamp, op: [type, data] } = op;
    const opTime = new Date(timestamp + 'Z').getTime();
    // Use claim_reward_balance (actual claimed curation), not curation_reward (earned/assigned)
    if (type === 'claim_reward_balance' && opTime >= fromTime && opTime < toTime) {
      const claimedVests = parseFloat(data.reward_vests);
      if (claimedVests > 0) {
        totalVests += claimedVests;
        claimCount++;
        log(`  💰 Claimed: ${claimedVests.toFixed(6)} VESTS at ${timestamp}`);
      }
    }
  }

  log(`  📊 Total claims in window: ${claimCount}`);

  const totalHive = vestsToHP(totalVests, totalVestingFundHive, totalVestingShares);
  return totalHive;
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  let db;
  try {
    log(`🚀 Fetching real delegators for @${ACCOUNT}...`);

    // Initialize sync database and get last processed index
    db = initSyncDB();
    const lastIndex = getLastIndex(db);
    log(`📊 Last processed index from DB: ${lastIndex}`);

    await pickWorkingNode();

    // Check account exists
    const accountInfo = await hive.api.getAccountsAsync([ACCOUNT]);
    if (!accountInfo || accountInfo.length === 0) {
      log(`❌ Account @${ACCOUNT} not found!`);
      db.close();
      process.exit(1);
    }
    log(`✅ Account found: ${accountInfo[0].name}`);
    log(`📊 Received vesting shares: ${accountInfo[0].received_vesting_shares}`);

    // Get global properties
    const { totalVestingFundHive, totalVestingShares } = await fetchGlobalProps();

    // Incremental sync: fetch only new operations since last index
    const { newOperations, latestIndex, hasNew } = await syncAccountHistory(lastIndex);

    if (!hasNew) {
      log(`ℹ️ No new operations to process. Existing data unchanged.`);
      db.close();
      return;
    }

    // Build or merge delegation history
    let delegationHistory;

    if (lastIndex === 0) {
      // Initial full sync: build delegation history from all operations
      log(`🔄 Initial full sync: building delegation history from ${newOperations.length} operations...`);
      delegationHistory = buildDelegationHistory(newOperations, totalVestingFundHive, totalVestingShares);
    } else {
      // Incremental sync: load existing history and merge new events
      log(`🔄 Incremental sync: merging ${newOperations.length} new operations...`);
      delegationHistory = loadExistingDelegationHistory();
      delegationHistory = mergeNewDelegationEvents(delegationHistory, newOperations, totalVestingFundHive, totalVestingShares);
    }

    // Save delegation_history.json
    fs.writeFileSync(DELEGATION_HISTORY_FILE, JSON.stringify(delegationHistory, null, 2));
    log(`💾 Saved delegation_history.json`);
    log(`👥 Total delegators found in history: ${Object.keys(delegationHistory).length}`);

    // Get active delegators (those with positive current delegation)
    const activeDelegators = getActiveDelegators(delegationHistory);
    const activeCount = Object.keys(activeDelegators).length;
    log(`\n👥 Active delegators: ${activeCount}`);

    if (activeCount === 0) {
      log('⚠️ No active delegators found.');
      updateLastIndex(db, latestIndex);
      db.close();
      process.exit(0);
    }

    // Fetch curation rewards (last 24h) - scans new operations
    const totalCurationHive = await getCurationRewards(newOperations, totalVestingFundHive, totalVestingShares);
    log(`📊 Total curation rewards (last 24h): ${totalCurationHive.toFixed(6)} HIVE`);

    // Apply 6-day eligibility cutoff (same as reference payout.js)
    const phTz = 'Asia/Manila';
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: phTz }));
    now.setHours(0, 0, 0, 0); // midnight Manila
    const cutoff = now.getTime() - 6 * 24 * 60 * 60 * 1000; // 6 days ago

    log(`\n⏰ Eligibility cutoff: ${new Date(cutoff).toISOString()} (6 days ago)`);

    // Calculate eligible delegators (delegated at least 6 days ago)
    const eligibleDelegators = {};
    let eligibleTotalHP = 0;

    for (const [delegator, events] of Object.entries(delegationHistory)) {
      const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);
      let runningBalance = 0;
      let eligibleVests = 0;

      for (const event of sortedEvents) {
        const eventTime = event.timestamp;
        const beforeBalance = runningBalance;
        runningBalance += event.vests;

        const isEventEligible = eventTime <= cutoff;

        if (isEventEligible) {
          eligibleVests = Math.max(0, runningBalance);
        }
      }

      const currentDelegation = Math.max(0, runningBalance);
      eligibleVests = Math.min(eligibleVests, currentDelegation);

      if (eligibleVests > 0) {
        const eligibleHP = vestsToHP(eligibleVests, totalVestingFundHive, totalVestingShares);
        eligibleDelegators[delegator] = eligibleHP;
        eligibleTotalHP += eligibleHP;
      }
    }

    log(`👥 Eligible delegators (6+ days): ${Object.keys(eligibleDelegators).length}`);
    log(`📈 Total eligible delegation (HP): ${eligibleTotalHP.toFixed(3)} HP`);

    if (eligibleTotalHP === 0) {
      log('⚠️ No eligible delegations found.');
      updateLastIndex(db, latestIndex);
      db.close();
      process.exit(0);
    }

    // Distribute 95% of curation rewards proportionally to eligible delegators
    const distributable = totalCurationHive * 0.95;

    // Build delegator list with base rewards
    const delegatorData = [];

    log('\n📋 Eligible Delegator Rewards:');
    log('─'.repeat(60));

    // Sort by HP descending
    const sortedDelegators = Object.entries(eligibleDelegators).sort((a, b) => b[1] - a[1]);

    for (const [delegator, hp] of sortedDelegators) {
      const share = hp / eligibleTotalHP;
      const baseReward = parseFloat((distributable * share).toFixed(6));

      delegatorData.push({
        name: delegator,
        hp: parseFloat(hp.toFixed(3)),
        base_reward: baseReward
      });

      const percent = (share * 100).toFixed(2);
      log(`  (${percent}%) @${delegator}: ${hp.toFixed(3)} HP → reward: ${baseReward} HIVE`);
    }

    log('─'.repeat(60));

    // Create payout summary
    const payoutSummary = {
      date: getTodayUTC(),
      total_delegation_hp: parseFloat(eligibleTotalHP.toFixed(3)),
      total_curation_hive: parseFloat(totalCurationHive.toFixed(6)),
      distributable_hive: parseFloat(distributable.toFixed(6)),
      delegators: delegatorData
    };

    // Save payout_summary.json
    saveJSON('payout_summary.json', payoutSummary);

    log(`\n📊 Summary:`);
    log(`   Total active delegation: ${Object.values(activeDelegators).reduce((a, b) => a + b, 0).toFixed(3)} HP`);
    log(`   Eligible delegation (6+ days): ${eligibleTotalHP.toFixed(3)} HP`);
    log(`   Active delegators: ${activeCount}`);
    log(`   Eligible delegators: ${Object.keys(eligibleDelegators).length}`);
    log(`   Total curation (24h): ${totalCurationHive.toFixed(6)} HIVE`);
    log(`   Distributable (95%): ${distributable.toFixed(6)} HIVE`);
    log(`   Retained (5%): ${(totalCurationHive * 0.05).toFixed(6)} HIVE`);

    // ── Crash-safe: update sync state ONLY after full success ──
    updateLastIndex(db, latestIndex);
    db.close();

    log(`\n✅ payout_summary.json and delegation_history.json updated!`);

  } catch (error) {
    log(`❌ Error: ${error.message}`);
    console.error(error);
    if (db) db.close();
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { main };
