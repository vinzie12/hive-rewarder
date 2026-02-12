/**
 * app.js — Frontend JS for hive-rewarder dashboard.
 * Reads JSON data files and renders the delegator dashboard.
 * No live backend required; reads JSON directly.
 */

// Base path for data files (GitHub Pages deployment)
const DATA_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? '../data'
  : '/hive-rewarder/data';

async function loadJSON(filename) {
  try {
    const url = `${DATA_BASE}/${filename}`;
    console.log(`Loading: ${url}`);
    const res = await fetch(url);
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

function getRankClass(rank) {
  if (rank <= 3) return `rank--${rank}`;
  return 'rank--default';
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadDashboard() {
  const loadingEl = document.getElementById('loading');
  const dashboardEl = document.getElementById('dashboard');
  const statusBadge = document.getElementById('header-status');

  try {
    const [payoutSummary, balances, sbiLog] = await Promise.all([
      loadJSON('payout_summary.json'),
      loadJSON('delegator_balances.json'),
      loadJSON('sbi_log.json')
    ]);

    if (!payoutSummary || !balances) {
      loadingEl.innerHTML = `
        <div class="loading-card">
          <div style="font-size: 2rem; margin-bottom: 1rem;">&#9888;</div>
          <p style="color: var(--accent);">Failed to load data files</p>
          <p class="loading-sub">Make sure JSON data is available and deployed.</p>
        </div>`;
      statusBadge.innerHTML = '<span class="pulse"></span><span>Offline</span>';
      return;
    }

    // Hide loading, show dashboard
    loadingEl.style.display = 'none';
    dashboardEl.style.display = 'block';

    // Update header status
    statusBadge.classList.add('live');
    statusBadge.innerHTML = '<span class="pulse"></span><span>Live</span>';

    const multiplier = getMultiplier(payoutSummary.total_delegation_hp);
    const totalHP = payoutSummary.total_delegation_hp;
    const curationHive = payoutSummary.total_curation_hive || 0;

    // Stat cards
    document.getElementById('stat-date').textContent = formatDate(payoutSummary.date);
    document.getElementById('stat-delegation').textContent = `${totalHP.toLocaleString()} HP`;
    document.getElementById('stat-curation').textContent = `${curationHive.toFixed(3)} HIVE`;
    document.getElementById('stat-multiplier').textContent = `x${multiplier}`;
    document.getElementById('stat-delegators').textContent = payoutSummary.delegators.length;

    // Delegator table
    const tbody = document.getElementById('delegator-tbody');
    tbody.innerHTML = '';

    let chartData = [];
    let rank = 0;

    // Filter out zero-reward delegators for ranking, keep them in table
    const rankedDelegators = payoutSummary.delegators.filter(d => d.base_reward > 0);

    for (const d of payoutSummary.delegators) {
      const isRanked = d.base_reward > 0;
      if (isRanked) rank++;

      const adjustedReward = parseFloat((d.base_reward * multiplier).toFixed(3));
      const bal = balances[d.name] || { balance: 0, total_sent: 0 };
      const share = totalHP > 0 ? ((d.hp / totalHP) * 100) : 0;
      const initial = d.name.charAt(0).toUpperCase();

      const tr = document.createElement('tr');
      tr.dataset.name = d.name.toLowerCase();
      tr.innerHTML = `
        <td><span class="rank ${isRanked ? getRankClass(rank) : 'rank--default'}">${isRanked ? rank : '—'}</span></td>
        <td>
          <div class="delegator-name">
            <div class="delegator-avatar">${initial}</div>
            <a href="https://peakd.com/@${d.name}" target="_blank" class="delegator-link">@${d.name}</a>
          </div>
        </td>
        <td class="mono">${d.hp.toLocaleString()} HP</td>
        <td>
          <div class="share-cell">
            <div class="share-bar"><div class="share-bar-fill" style="width: ${Math.min(share * 3, 100)}%"></div></div>
            <span class="share-pct">${share.toFixed(1)}%</span>
          </div>
        </td>
        <td class="mono">${d.base_reward > 0 ? d.base_reward.toFixed(3) : '—'}</td>
        <td class="mono green">${adjustedReward > 0 ? adjustedReward.toFixed(3) : '—'}</td>
        <td class="mono blue">${bal.balance.toFixed(3)}</td>
        <td class="mono">${bal.total_sent.toFixed(3)}</td>
      `;
      tbody.appendChild(tr);

      chartData.push({
        name: d.name,
        balance: bal.balance,
        totalSent: bal.total_sent,
        hp: d.hp
      });
    }

    // Also include delegators in balances but not in today's payout
    for (const [name, data] of Object.entries(balances)) {
      if (!payoutSummary.delegators.find(d => d.name === name)) {
        const initial = name.charAt(0).toUpperCase();
        const tr = document.createElement('tr');
        tr.dataset.name = name.toLowerCase();
        tr.innerHTML = `
          <td><span class="rank rank--default">—</span></td>
          <td>
            <div class="delegator-name">
              <div class="delegator-avatar">${initial}</div>
              <a href="https://peakd.com/@${name}" target="_blank" class="delegator-link">@${name}</a>
            </div>
          </td>
          <td class="mono">—</td>
          <td><div class="share-cell"><span class="share-pct" style="color: var(--text-muted);">—</span></div></td>
          <td class="mono">—</td>
          <td class="mono green">—</td>
          <td class="mono blue">${data.balance.toFixed(3)}</td>
          <td class="mono">${data.total_sent.toFixed(3)}</td>
        `;
        tbody.appendChild(tr);

        chartData.push({
          name: name,
          balance: data.balance,
          totalSent: data.total_sent,
          hp: 0
        });
      }
    }

    // Search filter
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      const rows = tbody.querySelectorAll('tr');
      rows.forEach(row => {
        const name = row.dataset.name || '';
        row.style.display = name.includes(query) ? '' : 'none';
      });
    });

    // Render bar chart
    renderChart(chartData);

    // SBI Log
    const sbiTbody = document.getElementById('sbi-tbody');
    sbiTbody.innerHTML = '';

    if (sbiLog && sbiLog.length > 0) {
      const recent = [...sbiLog].reverse().slice(0, 20);
      for (const entry of recent) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${formatDate(entry.date)}</td>
          <td>
            <div class="delegator-name">
              <div class="delegator-avatar">${entry.delegator.charAt(0).toUpperCase()}</div>
              <a href="https://peakd.com/@${entry.delegator}" target="_blank" class="delegator-link">@${entry.delegator}</a>
            </div>
          </td>
          <td class="mono green">${entry.sent.toFixed(3)} HIVE</td>
          <td><span class="status-badge status-badge--sent">Sent</span></td>
        `;
        sbiTbody.appendChild(tr);
      }
    } else {
      sbiTbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-secondary); padding: 2rem;">No SBI transactions yet.</td></tr>';
    }

  } catch (err) {
    console.error('Dashboard error:', err);
    loadingEl.innerHTML = `
      <div class="loading-card">
        <div style="font-size: 2rem; margin-bottom: 1rem;">&#9888;</div>
        <p style="color: var(--accent);">An error occurred loading the dashboard</p>
        <p class="loading-sub">${err.message}</p>
      </div>`;
  }
}

function renderChart(data) {
  const container = document.getElementById('bar-chart');
  container.innerHTML = '';

  // Sort by HP descending, filter out zero
  const sorted = data.filter(d => d.balance + d.totalSent > 0 || d.hp > 0)
    .sort((a, b) => b.hp - a.hp);

  if (sorted.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 2rem;">No reward data to display.</p>';
    return;
  }

  const maxVal = Math.max(...sorted.map(d => d.balance + d.totalSent), 0.001);

  for (const d of sorted) {
    const total = d.balance + d.totalSent;
    const heightPercent = Math.max((total / maxVal) * 100, 2);

    const group = document.createElement('div');
    group.className = 'bar-group';

    group.innerHTML = `
      <div class="bar-value">${total > 0 ? total.toFixed(1) : '0'}</div>
      <div class="bar" style="height: ${heightPercent}%">
        <div class="bar-tooltip">@${d.name}<br>Balance: ${d.balance.toFixed(3)}<br>Sent: ${d.totalSent.toFixed(3)}<br>HP: ${d.hp.toLocaleString()}</div>
      </div>
      <div class="bar-label">@${d.name}</div>
    `;

    container.appendChild(group);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', loadDashboard);
