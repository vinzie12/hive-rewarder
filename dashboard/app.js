/**
 * app.js — Frontend JS for hive-rewarder dashboard.
 * Reads JSON data files and renders the delegator dashboard.
 * No live backend required; reads JSON directly.
 */

// Base path for data files (adjust for GitHub Pages deployment)
const DATA_BASE = '../data';

async function loadJSON(filename) {
  try {
    const res = await fetch(`${DATA_BASE}/${filename}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error(`Failed to load ${filename}:`, err);
    return null;
  }
}

function getMultiplier(totalDelegationHP) {
  return totalDelegationHP < 10000 ? 3 : 1;
}

async function loadDashboard() {
  const loadingEl = document.getElementById('loading');
  const dashboardEl = document.getElementById('dashboard');

  try {
    const [payoutSummary, balances, sbiLog] = await Promise.all([
      loadJSON('payout_summary.json'),
      loadJSON('delegator_balances.json'),
      loadJSON('sbi_log.json')
    ]);

    if (!payoutSummary || !balances) {
      loadingEl.innerHTML = '<p style="color: #e3342f;">Failed to load data files. Make sure JSON data is available.</p>';
      return;
    }

    // Hide loading, show dashboard
    loadingEl.style.display = 'none';
    dashboardEl.style.display = 'block';

    const multiplier = getMultiplier(payoutSummary.total_delegation_hp);

    // Stat cards
    document.getElementById('stat-date').textContent = payoutSummary.date;
    document.getElementById('stat-delegation').textContent = `${payoutSummary.total_delegation_hp.toLocaleString()} HP`;
    document.getElementById('stat-multiplier').textContent = `x${multiplier}`;
    document.getElementById('stat-delegators').textContent = payoutSummary.delegators.length;

    // Delegator table
    const tbody = document.getElementById('delegator-tbody');
    tbody.innerHTML = '';

    let chartData = [];

    for (const d of payoutSummary.delegators) {
      const adjustedReward = parseFloat((d.base_reward * multiplier).toFixed(3));
      const bal = balances[d.name] || { balance: 0, total_sent: 0 };

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>@${d.name}</td>
        <td class="mono">${d.base_reward.toFixed(3)}</td>
        <td class="mono orange">x${multiplier}</td>
        <td class="mono green">${adjustedReward.toFixed(3)}</td>
        <td class="mono blue">${bal.balance.toFixed(3)}</td>
        <td class="mono">${bal.total_sent.toFixed(3)}</td>
      `;
      tbody.appendChild(tr);

      chartData.push({
        name: d.name,
        balance: bal.balance,
        totalSent: bal.total_sent
      });
    }

    // Also include delegators in balances but not in today's payout
    for (const [name, data] of Object.entries(balances)) {
      if (!payoutSummary.delegators.find(d => d.name === name)) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>@${name}</td>
          <td class="mono">—</td>
          <td class="mono orange">x${multiplier}</td>
          <td class="mono green">—</td>
          <td class="mono blue">${data.balance.toFixed(3)}</td>
          <td class="mono">${data.total_sent.toFixed(3)}</td>
        `;
        tbody.appendChild(tr);

        chartData.push({
          name: name,
          balance: data.balance,
          totalSent: data.total_sent
        });
      }
    }

    // Render bar chart
    renderChart(chartData);

    // SBI Log
    const sbiTbody = document.getElementById('sbi-tbody');
    sbiTbody.innerHTML = '';

    if (sbiLog && sbiLog.length > 0) {
      // Show most recent first
      const recent = [...sbiLog].reverse().slice(0, 20);
      for (const entry of recent) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${entry.date}</td>
          <td>@${entry.delegator}</td>
          <td class="mono green">${entry.sent.toFixed(3)} HIVE</td>
        `;
        sbiTbody.appendChild(tr);
      }
    } else {
      sbiTbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color: var(--text-secondary);">No SBI transactions yet.</td></tr>';
    }

  } catch (err) {
    console.error('Dashboard error:', err);
    loadingEl.innerHTML = '<p style="color: #e3342f;">An error occurred loading the dashboard.</p>';
  }
}

function renderChart(data) {
  const container = document.getElementById('bar-chart');
  container.innerHTML = '';

  if (data.length === 0) return;

  // Find max value for scaling
  const maxVal = Math.max(...data.map(d => d.balance + d.totalSent), 1);

  for (const d of data) {
    const total = d.balance + d.totalSent;
    const heightPercent = Math.max((total / maxVal) * 100, 2);

    const group = document.createElement('div');
    group.className = 'bar-group';

    group.innerHTML = `
      <div class="bar-value">${total.toFixed(2)}</div>
      <div class="bar" style="height: ${heightPercent}%" title="Balance: ${d.balance.toFixed(3)} | Sent: ${d.totalSent.toFixed(3)}"></div>
      <div class="bar-label">@${d.name}</div>
    `;

    container.appendChild(group);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', loadDashboard);
