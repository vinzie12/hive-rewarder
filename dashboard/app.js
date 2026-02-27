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
    const [payoutSummary, balances, sbiLog, payoutHistory, config] = await Promise.all([
      loadJSON('payout_summary.json'),
      loadJSON('delegator_balances.json'),
      loadJSON('sbi_log.json'),
      loadJSON('payout_history.json'),
      loadJSON('config.json')
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

    const excludedFromSbi = new Set(
      (config && Array.isArray(config.excluded_from_sbi) ? config.excluded_from_sbi : [])
        .map(n => String(n).toLowerCase())
    );

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

      const isExcluded = excludedFromSbi.has(d.name.toLowerCase());

      const tr = document.createElement('tr');
      tr.dataset.name = d.name.toLowerCase();
      if (isExcluded) tr.classList.add('row-excluded');
      tr.innerHTML = `
        <td><span class="rank ${isRanked ? getRankClass(rank) : 'rank--default'}">${isRanked ? rank : '—'}</span></td>
        <td>
          <div class="delegator-name">
            <div class="delegator-avatar">${initial}</div>
            <a href="https://peakd.com/@${d.name}" target="_blank" class="delegator-link">@${d.name}</a>
            ${isExcluded ? '<span class="badge badge--excluded">Excluded from SBI</span>' : ''}
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
      if (name === '_meta') continue;
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

    // Build chart data by date from payout history
    const chartByDate = {};
    if (payoutHistory && Array.isArray(payoutHistory)) {
      for (const payout of payoutHistory) {
        chartByDate[payout.date] = payout.delegators || [];
      }
    }
    // Add today's data
    if (payoutSummary && payoutSummary.delegators) {
      chartByDate[payoutSummary.date] = payoutSummary.delegators;
    }

    // Chart toolbar (defensive: do not crash dashboard if chart UI mismatches)
    const dateSelect = document.getElementById('chart-date-select');
    const filterInput = document.getElementById('chart-filter');
    const topSelect = document.getElementById('chart-top');
    const chartMeta = document.getElementById('chart-meta');
    const chartContainer = document.getElementById('bar-chart');

    const dates = Object.keys(chartByDate).sort().reverse();
    const initialDate = dates[0] || payoutSummary.date;

    const canRenderChart = Boolean(dateSelect && filterInput && topSelect && chartMeta && chartContainer);
    if (!canRenderChart) {
      if (chartContainer) {
        chartContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 2rem;">Chart UI is updating. Please refresh in a few seconds.</p>';
      }
    } else {
      dateSelect.innerHTML = '';
      for (const date of dates) {
        const opt = document.createElement('option');
        opt.value = date;
        opt.textContent = formatDate(date);
        if (date === initialDate) opt.selected = true;
        dateSelect.appendChild(opt);
      }

      function updateChart() {
        const date = dateSelect.value || initialDate;
        const q = (filterInput.value || '').toLowerCase().trim();
        const topVal = topSelect.value;

        const raw = chartByDate[date] || [];
        const filtered = q
          ? raw.filter(d => (d.name || '').toLowerCase().includes(q))
          : raw;

        const sorted = [...filtered].sort((a, b) => (b.base_reward || 0) - (a.base_reward || 0));
        const limited = topVal === 'all' ? sorted : sorted.slice(0, Number(topVal) || 20);

        const total = raw.length;
        const showing = limited.length;
        const sum = raw.reduce((acc, d) => acc + (d.base_reward || 0), 0);
        chartMeta.textContent = `${formatDate(date)} • ${showing}/${total} delegators • ${sum.toFixed(3)} HIVE distributable`;

        renderChartForDate(limited);
      }

      dateSelect.addEventListener('change', updateChart);
      topSelect.addEventListener('change', updateChart);
      filterInput.addEventListener('input', updateChart);

      // Render initial chart
      updateChart();
    }

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

function renderChartForDate(delegators) {
  const container = document.getElementById('bar-chart');
  container.innerHTML = '';

  if (!delegators || delegators.length === 0) {
    container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 2rem;">No reward data for this date.</p>';
    return;
  }

  // Sort by reward descending
  const sorted = [...delegators].sort((a, b) => (b.base_reward || 0) - (a.base_reward || 0));
  const maxVal = Math.max(...sorted.map(d => d.base_reward || 0), 0.001);

  const list = document.createElement('div');
  list.className = 'hbar-list';

  for (let i = 0; i < sorted.length; i++) {
    const d = sorted[i];
    const reward = d.base_reward || 0;
    const widthPercent = Math.max((reward / maxVal) * 100, 1.5);
    const row = document.createElement('div');
    row.className = 'hbar-row';
    row.innerHTML = `
      <div class="hbar-rank mono">${i + 1}</div>
      <div class="hbar-name">
        <a href="https://peakd.com/@${d.name}" target="_blank" class="delegator-link">@${d.name}</a>
        <div class="hbar-sub mono">${(d.hp || 0).toLocaleString()} HP</div>
      </div>
      <div class="hbar-track">
        <div class="hbar-fill" style="width: ${widthPercent}%"></div>
      </div>
      <div class="hbar-val mono">${reward.toFixed(3)} HIVE</div>
    `;
    row.title = `@${d.name}\nHP: ${(d.hp || 0).toLocaleString()}\nReward: ${reward.toFixed(3)} HIVE`;
    list.appendChild(row);
  }

  container.appendChild(list);
}

// Initialize dashboard
// Tab switching logic (always runs, even if dashboard loading fails)
document.addEventListener('DOMContentLoaded', () => {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;

      // Remove active from all buttons and panels
      tabBtns.forEach(b => b.classList.remove('tab-btn--active'));
      tabPanels.forEach(p => p.classList.remove('tab-panel--active'));

      // Add active to clicked button and corresponding panel
      btn.classList.add('tab-btn--active');
      document.querySelector(`[data-panel="${tabName}"]`).classList.add('tab-panel--active');
    });
  });
});

document.addEventListener('DOMContentLoaded', loadDashboard);
