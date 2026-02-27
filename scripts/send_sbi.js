/**
 * send_sbi.js
 * Sends 1 HIVE chunks to @steembasicincome (SBI) on behalf of delegators
 * when their accumulated balance >= 1 HIVE.
 *
 * Supports dry-run mode via DRY_RUN=true environment variable.
 * In production, requires HIVE_USER and HIVE_KEY environment variables.
 */

const hive = require('@hiveio/hive-js');
const { loadJSON, saveJSON, getTodayUTC, formatHIVE, log } = require('./utils');

const IS_DRY_RUN = process.env.DRY_RUN === 'true';
const HIVE_USER = process.env.HIVE_USER || 'bayanihive';
const ACTIVE_KEY = process.env.HIVE_KEY || '';

const SBI_ACCOUNT = 'steembasicincome';
const SBI_CHUNK = 1.0;

function getExcludedDelegators() {
  const cfg = loadJSON('config.json', {});
  const fromFile = Array.isArray(cfg.excluded_from_sbi) ? cfg.excluded_from_sbi : [];
  const fromEnv = (process.env.SBI_EXCLUDE || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return new Set([...fromFile, ...fromEnv].map(s => s.toLowerCase()));
}

const HIVE_NODES = [
  'https://api.hive.blog',
  'https://api.openhive.network',
  'https://anyx.io',
  'https://rpc.ecency.com',
];

let currentNodeIndex = 0;

function setNextNode() {
  currentNodeIndex = (currentNodeIndex + 1) % HIVE_NODES.length;
  hive.api.setOptions({ url: HIVE_NODES[currentNodeIndex] });
  log(`🔁 Switched to Hive node: ${HIVE_NODES[currentNodeIndex]}`);
}

// Initialize first node
hive.api.setOptions({ url: HIVE_NODES[currentNodeIndex] });

/**
 * Send a single 1-HIVE SBI transfer for a delegator.
 * Memo format: @sponsor:@beneficiary
 */
async function sendSBI(delegator, retries = 3) {
  const memo = `@${HIVE_USER}:@${delegator}`;
  const amount = `${SBI_CHUNK.toFixed(3)} HIVE`;

  if (IS_DRY_RUN) {
    log(`🧪 DRY-RUN: Would send ${amount} from @${HIVE_USER} to @${SBI_ACCOUNT}`);
    log(`🧪 Memo: ${memo}`);
    return true;
  }

  if (!ACTIVE_KEY) {
    log('⚠️ Missing HIVE_KEY environment variable. Cannot send SBI.');
    return false;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        hive.broadcast.transfer(
          ACTIVE_KEY,
          HIVE_USER,
          SBI_ACCOUNT,
          amount,
          memo,
          (err, res) => {
            if (err) return reject(err);
            resolve(res);
          }
        );
      });
      log(`✅ Sent ${amount} to @${SBI_ACCOUNT} for @${delegator}`);
      log(`📝 Transaction ID: ${result.id}`);
      return true;
    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed for @${delegator}: ${error.message}`);
      if (attempt < retries) {
        setNextNode();
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  console.error(`🚨 All ${retries} attempts failed for @${delegator}.`);
  return false;
}

/**
 * Process all delegator balances: send 1-HIVE SBI chunks where balance >= 1.
 * Updates delegator_balances.json and sbi_log.json accordingly.
 */
async function processSBIPayouts() {
  log('💸 Processing SBI payouts...');

  if (IS_DRY_RUN) {
    log('🧪 Running in DRY-RUN mode. No real transactions will be sent.');
  }

  const balances = loadJSON('delegator_balances.json', {});
  const sbiLog = loadJSON('sbi_log.json', []);
  const today = getTodayUTC();

  const excluded = getExcludedDelegators();

  let totalSent = 0;

  for (const [delegator, data] of Object.entries(balances)) {
    if (delegator === '_meta') continue;

    if (excluded.has(delegator.toLowerCase())) {
      if (data && typeof data.balance === 'number' && data.balance >= SBI_CHUNK) {
        log(`⛔ Excluded from SBI: @${delegator} (balance: ${data.balance})`);
      }
      continue;
    }

    while (data.balance >= SBI_CHUNK) {
      const success = await sendSBI(delegator);

      if (success) {
        data.balance = formatHIVE(data.balance - SBI_CHUNK);
        data.total_sent = formatHIVE((data.total_sent || 0) + SBI_CHUNK);
        data.last_updated = today;

        sbiLog.push({
          date: today,
          delegator: delegator,
          sent: SBI_CHUNK
        });

        totalSent += SBI_CHUNK;
        log(`📤 @${delegator}: sent ${SBI_CHUNK} HIVE to SBI | balance: ${data.balance} | total_sent: ${data.total_sent}`);
      } else {
        log(`⚠️ Skipping further SBI sends for @${delegator} due to failure.`);
        break;
      }
    }
  }

  saveJSON('delegator_balances.json', balances);
  saveJSON('sbi_log.json', sbiLog);

  log(`\n📊 SBI Payout Summary:`);
  log(`   Total chunks sent: ${totalSent} HIVE`);
  log(`   Transactions logged: ${totalSent / SBI_CHUNK}`);

  if (IS_DRY_RUN) {
    log('🧪 DRY-RUN complete. No actual HIVE was transferred.');
  }
}

// Run if executed directly
if (require.main === module) {
  processSBIPayouts().catch((err) => {
    console.error('Unhandled error in SBI payout:', err);
    process.exit(1);
  });
}

module.exports = { sendSBI, processSBIPayouts };
