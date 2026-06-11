/* ══════════════════════════════════════════════════════════════════════════
   ICP Score — Dashboard JS
   ══════════════════════════════════════════════════════════════════════════ */

const API = '/api';

let chartCategory = null;
let chartGeo      = null;
let chartRepCat   = null;
let chartWeekly   = null;
let chartScoreDist = null;
let allContacts   = [];
let fileLeads     = [];       // results from last file analysis
let adminConfig   = null;     // current scoring config in Admin Panel
let activeAdminTab = 'companySize';

const PALETTE = ['#2d5ce6','#65bc7b','#f59e0b','#ef4444','#6239bd','#14cfc3','#f97316','#84cc16'];

// ══════════════════════════════════════════════════════════════════════════════
//  Utilities
// ══════════════════════════════════════════════════════════════════════════════

function showToast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), duration);
}

async function apiFetch(path, options = {}) {
  const res  = await fetch(API + path, options);
  const data = await res.json();
  if (!data.ok) throw new Error(data.message || 'Unknown error');
  return data;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function categoryBadge(cat) {
  if (!cat) return '<span class="badge badge-non">—</span>';
  const map = { 'Core ICP':'badge-core','Strong ICP':'badge-strong','Moderate ICP':'badge-moderate','Non ICP':'badge-non' };
  return `<span class="badge ${map[cat] || 'badge-non'}">${escHtml(cat)}</span>`;
}

function priorityBadge(p) {
  if (!p) return '—';
  const map = { 'Highest Priority':'badge-highest','High Priority':'badge-high','Nurture':'badge-nurture','Low Priority':'badge-low' };
  return `<span class="badge ${map[p] || 'badge-low'}">${escHtml(p)}</span>`;
}

function scoreBar(score) {
  if (score == null) return '—';
  const pct  = Math.min(100, Math.max(0, score));
  let col    = '#ef4444';
  if (pct >= 80) col = '#4f8ef7'; else if (pct >= 65) col = '#22c55e'; else if (pct >= 50) col = '#f59e0b';
  return `<div class="score-bar-wrap">
    <div class="score-bar-track"><div class="score-bar-fill" style="width:${pct}%;background:${col}"></div></div>
    <span class="score-bar-val" style="color:${col}">${score}</span>
  </div>`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ══════════════════════════════════════════════════════════════════════════════
//  Navigation
// ══════════════════════════════════════════════════════════════════════════════

function switchView(view) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`view-${view}`)?.classList.add('active');
  document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add('active');

  const titles = {
    dashboard:'Dashboard', 'rep-tracker':'Rep Tracker', 'hubspot-pull':'HubSpot Pull',
    pdf:'File Upload', contacts:'Contacts', score:'Run Scoring', admin:'Admin Panel', setup:'Setup'
  };
  document.getElementById('pageTitle').textContent = titles[view] || 'ICP Score';


  if (view === 'dashboard')      loadDashboard();
  if (view === 'contacts')       loadContacts();
  if (view === 'admin')          loadAdminConfig();
  if (view === 'rep-tracker')    loadRepTracker();
  if (view === 'hubspot-pull')   loadHubspotPullView();
  if (view === 'pdf')            loadRepSelectorsForUpload();
}

// ══════════════════════════════════════════════════════════════════════════════
//  Connection Status
// ══════════════════════════════════════════════════════════════════════════════

async function checkConnection() {
  const el = document.getElementById('connectionStatus');
  try {
    await apiFetch('/status');
    el.className = 'connection-status ok';
    el.querySelector('span').textContent = 'Connected';
  } catch {
    el.className = 'connection-status err';
    el.querySelector('span').textContent = 'Not connected';
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  HubSpot Sync
// ══════════════════════════════════════════════════════════════════════════════

async function loadSyncStatus() {
  try {
    const data = await apiFetch('/sync/status');
    updateSyncIndicator(data.lastSync, data.contactCount);
  } catch (_) {}
}

function updateSyncIndicator(lastSync, contactCount) {
  const indicator = document.getElementById('syncIndicator');
  const text = document.getElementById('syncText');
  if (lastSync) {
    indicator.className = 'sync-indicator synced';
    const d = new Date(lastSync);
    const ago = timeAgo(d);
    text.textContent = `${contactCount || 0} contacts · Synced ${ago}`;
    text.title = d.toLocaleString();
  } else {
    indicator.className = 'sync-indicator';
    text.textContent = 'Not synced yet';
  }
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60)   return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}

async function syncHubspot() {
  const banner = document.getElementById('syncBanner');
  const indicator = document.getElementById('syncIndicator');
  const btn = document.getElementById('btnSyncHubspot');

  banner.className = 'sync-banner';
  banner.classList.remove('hidden');
  document.getElementById('syncBannerMsg').textContent = 'Syncing contacts from HubSpot… this may take a minute';
  indicator.className = 'sync-indicator syncing';
  document.getElementById('syncText').textContent = 'Syncing…';
  btn.disabled = true;

  try {
    const data = await apiFetch('/sync/full', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    banner.className = 'sync-banner success';
    document.getElementById('syncBannerMsg').textContent =
      `Synced ${data.contacts} contacts, ${data.owners} owners`;
    updateSyncIndicator(data.lastSync, data.contacts);
    showToast(`Sync complete — ${data.contacts} contacts`, 4000);

    // Refresh the current view
    const v = document.querySelector('.view.active')?.id?.replace('view-','');
    if (v === 'dashboard') loadDashboard();
    else if (v === 'contacts') loadContacts();
    else if (v === 'rep-tracker') loadRepTracker();

    setTimeout(() => { banner.classList.add('hidden'); }, 5000);
  } catch (err) {
    banner.className = 'sync-banner error';
    document.getElementById('syncBannerMsg').textContent = 'Sync failed: ' + err.message;
    indicator.className = 'sync-indicator';
    document.getElementById('syncText').textContent = 'Sync failed';
    showToast('Sync failed: ' + err.message, 5000);
  } finally {
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  Dashboard
// ══════════════════════════════════════════════════════════════════════════════

async function loadDashboard() {
  try {
    const data = await apiFetch('/dashboard');
    document.getElementById('statTotal').textContent  = data.total;
    document.getElementById('statCore').textContent     = data.categoryCount['Core ICP']     || 0;
    document.getElementById('statStrong').textContent   = data.categoryCount['Strong ICP']   || 0;
    document.getElementById('statModerate').textContent = data.categoryCount['Moderate ICP'] || 0;
    document.getElementById('statNon').textContent      = data.categoryCount['Non ICP']      || 0;
    renderSegmentCards(data.segmentStats || {});
    renderCategoryChart(data.categoryCount);
    renderGeoChart(data.geographyCount);
    allHighPriorityLeads = data.highPriority || [];
    filterPriorityLeads();
  } catch (err) { showToast('Dashboard error: ' + err.message); }
}

function renderSegmentCards(segs) {
  const container = document.getElementById('segmentCardsRow');
  if (!segs || !Object.keys(segs).length) {
    container.innerHTML = '<p style="color:var(--muted);font-size:13px">No segment data — run a sync first.</p>';
    return;
  }
  const ORDER = ['SMB', 'MSP', 'Large MSP', 'Enterprise', 'Others'];
  const COLORS = { SMB: '#3b82f6', MSP: '#22c55e', 'Large MSP': '#f59e0b', Enterprise: '#8b5cf6', Others: '#6b7280' };
  const DEFAULT_COLOR = '#06b6d4';
  // Sort: known order first, then alphabetically
  const keys = Object.keys(segs).sort((a, b) => {
    const ai = ORDER.indexOf(a), bi = ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
  container.innerHTML = keys.map(seg => {
    const s = segs[seg];
    const color = COLORS[seg] || DEFAULT_COLOR;
    return `
      <div class="segment-card" style="border-top-color:${color}">
        <div class="seg-title">${seg}</div>
        <div class="seg-total">${s.total}</div>
        <div class="seg-breakdown">
          <div class="seg-row"><span class="seg-dot dot-core"></span><span class="seg-cat">Core ICP</span><span class="seg-cnt">${s['Core ICP'] || 0}</span></div>
          <div class="seg-row"><span class="seg-dot dot-strong"></span><span class="seg-cat">Strong ICP</span><span class="seg-cnt">${s['Strong ICP'] || 0}</span></div>
          <div class="seg-row"><span class="seg-dot dot-moderate"></span><span class="seg-cat">Moderate ICP</span><span class="seg-cnt">${s['Moderate ICP'] || 0}</span></div>
          <div class="seg-row"><span class="seg-dot dot-non"></span><span class="seg-cat">Non ICP</span><span class="seg-cnt">${s['Non ICP'] || 0}</span></div>
        </div>
      </div>`;
  }).join('');
}

function renderCategoryChart(counts) {
  const labels  = ['Core ICP','Strong ICP','Moderate ICP','Non ICP'];
  const values  = labels.map(l => counts[l] || 0);
  const colours = ['#2d5ce6','#65bc7b','#f59e0b','#ef4444'];
  const ctx     = document.getElementById('chartCategory').getContext('2d');
  if (chartCategory) chartCategory.destroy();
  chartCategory = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colours, borderWidth: 0, hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: {
      legend: { position: 'bottom', labels: { color:'#8892aa', font:{ size:12 }, padding:16, boxWidth:12 } },
      tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } }
    }, cutout: '68%' }
  });
}

function renderGeoChart(counts) {
  const sorted  = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const ctx     = document.getElementById('chartGeo').getContext('2d');
  if (chartGeo) chartGeo.destroy();
  chartGeo = new Chart(ctx, {
    type: 'bar',
    data: { labels: sorted.map(([k])=>k||'Unknown'), datasets: [{ label:'Contacts', data: sorted.map(([,v])=>v), backgroundColor: PALETTE, borderRadius:5, borderSkipped:false }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis:'y', plugins: { legend:{ display:false } },
      scales: { x:{ ticks:{color:'#8892aa'}, grid:{color:'#2a2f47'} }, y:{ ticks:{color:'#8892aa'}, grid:{display:false} } } }
  });
}

let allHighPriorityLeads = [];

function filterPriorityLeads() {
  const seg = document.getElementById('prioritySegmentFilter')?.value || '';

  // Also populate the dropdown with any dynamic segments from the data
  const dropdown = document.getElementById('prioritySegmentFilter');
  if (dropdown && allHighPriorityLeads.length) {
    const known = ['SMB', 'MSP', 'Large MSP', 'Enterprise', 'Others'];
    const extra = [...new Set(allHighPriorityLeads.map(l => l.segment))].filter(s => s && !known.includes(s)).sort();
    const current = [...dropdown.options].map(o => o.value);
    extra.forEach(s => {
      if (!current.includes(s)) {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        dropdown.appendChild(opt);
      }
    });
  }

  const filtered = seg ? allHighPriorityLeads.filter(l => l.segment === seg) : allHighPriorityLeads;
  renderPriorityTable(filtered);
}

function renderPriorityTable(leads) {
  const tbody = document.getElementById('tbodyPriority');
  if (!leads.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No high-priority leads for this segment.</td></tr>'; return; }
  tbody.innerHTML = leads.map(l => `<tr>
    <td><div style="font-weight:500">${escHtml(l.name)}</div><div style="font-size:12px;color:#8892aa">${escHtml(l.email||'')}</div></td>
    <td style="font-size:12.5px;color:var(--muted)">${escHtml(l.segment||'—')}</td>
    <td>${scoreBar(l.score)}</td>
    <td>${categoryBadge(l.category)}</td>
    <td>${priorityBadge(l.priority)}</td>
  </tr>`).join('');
}

// ══════════════════════════════════════════════════════════════════════════════
//  Rep Tracker
// ══════════════════════════════════════════════════════════════════════════════

// ── State ────────────────────────────────────────────────────────────────────
let allReps  = [];
let allTeams = [];

function onRepPeriodChange() {
  const period = document.getElementById('repFilterPeriod').value;
  document.getElementById('repCustomDates').classList.toggle('hidden', period !== 'custom');
  if (period !== 'custom') loadRepTracker();
}

/** Compute { dateFrom, dateTo } strings from the period dropdown */
function getRepDateRange() {
  const period = document.getElementById('repFilterPeriod').value;
  const now    = new Date();

  if (period === 'custom') {
    return {
      dateFrom: document.getElementById('repDateFrom').value || undefined,
      dateTo:   document.getElementById('repDateTo').value   || undefined
    };
  }
  if (period === 'all') return {};

  const from = new Date(now);
  if (period === 'this_week') {
    from.setDate(now.getDate() - 7);
  } else if (period === 'this_month') {
    from.setDate(1); from.setHours(0, 0, 0, 0);
  } else if (period === 'last_3months') {
    from.setMonth(now.getMonth() - 3);
    from.setDate(1); from.setHours(0, 0, 0, 0);
  }
  return {
    dateFrom: from.toISOString().split('T')[0],
    dateTo:   now.toISOString().split('T')[0]
  };
}

async function loadRepsAndTeams() {
  try {
    const [rData, tData] = await Promise.all([apiFetch('/reps'), apiFetch('/teams')]);
    allReps  = rData.reps;
    allTeams = tData.teams;
  } catch (err) { console.error('Failed to load reps/teams:', err); }
}

function populateRepFilters(useHubspot = false) {
  // Team dropdown
  const teamSel = document.getElementById('repFilterTeam');
  const curTeam = teamSel.value;
  if (useHubspot) {
    teamSel.innerHTML = '<option value="">All Teams</option>' +
      hsTeams.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('');
  } else {
    teamSel.innerHTML = '<option value="">All Teams</option>' +
      allTeams.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('');
  }
  teamSel.value = curTeam;

}

async function loadRepSelectorsForUpload() {
  if (pdfViewReady) return;  // already initialised — keep existing results
  await loadRepsAndTeams();
  const sel     = document.getElementById('uploadRepSelect');
  const current = sel.value;
  sel.innerHTML = '<option value="">— No Rep (skip tracking) —</option>' +
    allReps.map(r => `<option value="${r.id}">${escHtml(r.name)}${r.teamName ? ' ('+escHtml(r.teamName)+')' : ''}</option>`).join('');
  sel.value = current;
  pdfViewReady = true;
}

async function loadRepTracker() {
  await loadHubspotRepStats();
}

// ── HubSpot Data mode ─────────────────────────────────────────────────────────

async function loadHubspotRepStats() {
  // Ensure owners/teams are loaded
  if (!hsOwners.length || !hsTeams.length) {
    try {
      const [od, td] = await Promise.allSettled([
        apiFetch('/hubspot/owners'),
        apiFetch('/hubspot/hs-teams')
      ]);
      if (od.status === 'fulfilled') hsOwners = od.value.owners || [];
      if (td.status === 'fulfilled') hsTeams  = td.value.teams  || [];
    } catch (_) {}
  }
  populateRepFilters(true);

  const { dateFrom, dateTo } = getRepDateRange();
  const teamId = document.getElementById('repFilterTeam').value;

  try {
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo)   params.set('dateTo',   dateTo);
    if (teamId)   params.set('teamId',   teamId);

    const data = await apiFetch(`/rep-tracker/hs-stats?${params}`);

    // Store all leads for chart click-through
    window._repAllLeads = data.allLeads || [];

    // Summary cards
    document.getElementById('repStatLeads').textContent    = data.total;
    document.getElementById('repStatAvgScore').textContent = data.avgScore > 0 ? data.avgScore : '—';
    document.getElementById('repStatCore').textContent     = data.categoryCount['Core ICP']     || 0;
    document.getElementById('repStatStrong').textContent   = data.categoryCount['Strong ICP']   || 0;
    document.getElementById('repStatModerate').textContent = data.categoryCount['Moderate ICP'] || 0;
    document.getElementById('repStatNon').textContent      = data.categoryCount['Non ICP']      || 0;

    // All filtering is now done server-side
    const ownerBreakdown = data.ownerBreakdown || [];

    renderRepCategoryChartHS(ownerBreakdown);
    renderWeeklyTrendChart(data.weeklyTrend, true);
    renderScoreDistChart(data.scoreRanges);
    renderRepLeaderboard(ownerBreakdown, true);
    renderTeamBreakdownHS(ownerBreakdown);
    renderRepTopLeads(data.topLeads, true);

  } catch (err) {
    showToast('Rep tracker (HubSpot) error: ' + err.message);
  }
}


// ── Chart renderers ───────────────────────────────────────────────────────────

function renderRepCategoryChartHS(ownerBreakdown) {
  const ctx = document.getElementById('chartRepCategory').getContext('2d');
  if (chartRepCat) chartRepCat.destroy();
  if (!ownerBreakdown.length) { chartRepCat = null; return; }

  const labels   = ownerBreakdown.map(o => o.ownerName);
  const cats     = ['Core ICP', 'Strong ICP', 'Moderate ICP', 'Non ICP'];
  const colors   = ['#2d5ce6', '#65bc7b', '#f59e0b', '#ef4444'];
  const datasets = cats.map((cat, i) => ({
    label: cat,
    data:  ownerBreakdown.map(o => o.categories[cat] || 0),
    backgroundColor: colors[i],
    borderRadius: 3,
    borderSkipped: false
  }));

  chartRepCat = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (e, elements) => {
        if (!elements.length) return;
        const el = elements[0];
        const ownerName = labels[el.index];
        const catName = cats[el.datasetIndex];
        const leads = (window._repAllLeads || []).filter(l => l.ownerName === ownerName && l.category === catName);
        showLeadPopup(`${ownerName} — ${catName}`, leads);
      },
      plugins: { legend: { position: 'bottom', labels: { color: '#7b8ba8', font: { size: 11 }, padding: 12, boxWidth: 10 } } },
      scales: {
        x: { stacked: true, ticks: { color: '#7b8ba8' }, grid: { display: false } },
        y: { stacked: true, ticks: { color: '#7b8ba8' }, grid: { color: '#1e2744' } }
      }
    }
  });
}

function renderRepCategoryChart(repBreakdown) {
  const ctx = document.getElementById('chartRepCategory').getContext('2d');
  if (chartRepCat) chartRepCat.destroy();
  if (!repBreakdown.length) { chartRepCat = null; return; }

  const labels   = repBreakdown.map(r => r.repName);
  const cats     = ['Core ICP', 'Strong ICP', 'Moderate ICP', 'Non ICP'];
  const colors   = ['#4f8ef7', '#22c55e', '#f59e0b', '#ef4444'];
  const datasets = cats.map((cat, i) => ({
    label: cat,
    data:  repBreakdown.map(r => r.categories[cat] || 0),
    backgroundColor: colors[i],
    borderRadius: 3,
    borderSkipped: false
  }));

  chartRepCat = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#8892aa', font: { size: 11 }, padding: 12, boxWidth: 10 } } },
      scales: {
        x: { stacked: true, ticks: { color: '#8892aa' }, grid: { display: false } },
        y: { stacked: true, ticks: { color: '#8892aa' }, grid: { color: '#2a2f47' } }
      }
    }
  });
}

function renderWeeklyTrendChart(trend, isHubspot = false) {
  const ctx = document.getElementById('chartWeeklyTrend').getContext('2d');
  if (chartWeekly) chartWeekly.destroy();
  if (!trend || !trend.length) return;

  const datasets = [
    {
      label: 'Total Leads',
      data: trend.map(w => w.leads),
      borderColor: '#4f8ef7',
      backgroundColor: 'rgba(79,142,247,.1)',
      fill: true, tension: 0.3,
      pointRadius: 4, pointBackgroundColor: '#4f8ef7'
    },
    {
      label: 'Core ICP',
      data: trend.map(w => w.coreICP),
      borderColor: '#22c55e',
      backgroundColor: 'rgba(34,197,94,.1)',
      fill: false, tension: 0.3,
      pointRadius: 3, pointBackgroundColor: '#22c55e'
    }
  ];

  if (isHubspot) {
    datasets.push({
      label: 'MQLs',
      data: trend.map(w => w.mqls || 0),
      borderColor: '#f97316',
      backgroundColor: 'rgba(249,115,22,.05)',
      fill: false, tension: 0.3,
      pointRadius: 3, pointBackgroundColor: '#f97316',
      borderDash: [5, 3]
    });
  }

  chartWeekly = new Chart(ctx, {
    type: 'line',
    data: { labels: trend.map(w => w.weekStart), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#8892aa', font: { size: 11 }, padding: 12, boxWidth: 10 } } },
      scales: {
        x: { ticks: { color: '#8892aa' }, grid: { color: '#2a2f47' } },
        y: { beginAtZero: true, ticks: { color: '#8892aa' }, grid: { color: '#2a2f47' } }
      }
    }
  });
}

// ── Table renderers ───────────────────────────────────────────────────────────

function renderScoreDistChart(scoreRanges) {
  const ctx = document.getElementById('chartScoreDist');
  if (!ctx) return;
  if (chartScoreDist) chartScoreDist.destroy();
  const sr = scoreRanges || {};
  const ranges = [[80,100],[65,79],[50,64],[0,49]];
  chartScoreDist = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels: ['80-100 (Core ICP)', '65-79 (Strong)', '50-64 (Moderate)', '0-49 (Non ICP)'],
      datasets: [{
        label: 'Leads',
        data: [sr.s80_100 || 0, sr.s65_79 || 0, sr.s50_64 || 0, sr.s0_49 || 0],
        backgroundColor: ['#2d5ce6', '#65bc7b', '#f59e0b', '#ef4444'],
        borderRadius: 5,
        borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      onClick: (e, elements) => {
        if (!elements.length) return;
        const [min, max] = ranges[elements[0].index];
        filterLeadsByScoreRange(min, max);
      },
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#7b8ba8' }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: '#7b8ba8', precision: 0 }, grid: { color: '#1e2744' } }
      }
    }
  });
}

function renderRepLeaderboard(reps, isHubspot = false) {
  const tbody = document.getElementById('tbodyRepLeaderboard');
  if (!reps || !reps.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">${isHubspot ? 'No data. Run a sync from the Dashboard.' : 'No data yet. Upload files with a rep selected.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = reps.map((r) => {
    const name = isHubspot ? (r.ownerName || '—') : (r.repName || '—');
    return `<tr style="cursor:pointer" onclick="filterLeadsByOwner('${escHtml(name).replace(/'/g, "\\'")}')">
    <td>
      <div style="font-weight:500">${escHtml(name)}</div>
      ${isHubspot && r.ownerEmail ? `<div style="font-size:11px;color:var(--muted)">${escHtml(r.ownerEmail)}</div>` : ''}
    </td>
    <td style="color:var(--muted);font-size:13px">${escHtml(isHubspot ? (r.ownerTeams || '—') : (r.teamName || '—'))}</td>
    <td><strong>${r.totalLeads}</strong></td>
    <td>${scoreBar(r.avgScore)}</td>
    <td><span style="color:var(--blue-light,#2d5ce6);font-weight:600;cursor:pointer" onclick="event.stopPropagation();filterLeadsByCategory('Core ICP')">${r.categories?.['Core ICP'] || 0}</span></td>
    <td><span style="color:var(--green);font-weight:600;cursor:pointer" onclick="event.stopPropagation();filterLeadsByCategory('Strong ICP')">${r.categories?.['Strong ICP'] || 0}</span></td>
    <td><span style="color:var(--yellow);font-weight:600;cursor:pointer" onclick="event.stopPropagation();filterLeadsByCategory('Moderate ICP')">${r.categories?.['Moderate ICP'] || 0}</span></td>
    <td><span style="color:var(--red);font-weight:600;cursor:pointer" onclick="event.stopPropagation();filterLeadsByCategory('Non ICP')">${r.categories?.['Non ICP'] || 0}</span></td>
  </tr>`;
  }).join('');
}

function renderTeamBreakdownHS(ownerBreakdown) {
  // Build team breakdown from owner data (HubSpot teams)
  const teamMap = {};
  ownerBreakdown.forEach(o => {
    const teams = o.ownerTeams ? o.ownerTeams.split(', ').filter(Boolean) : ['No Team'];
    teams.forEach(teamName => {
      if (!teamMap[teamName]) {
        teamMap[teamName] = { teamName, repCount: 0, totalLeads: 0, _tScore: 0, _tCount: 0, avgScore: 0, categories: {} };
      }
      const t = teamMap[teamName];
      t.repCount++;
      t.totalLeads += o.totalLeads;
      t._tScore    += o.avgScore * o.totalLeads;
      t._tCount    += o.totalLeads;
      Object.entries(o.categories || {}).forEach(([cat, cnt]) => {
        t.categories[cat] = (t.categories[cat] || 0) + cnt;
      });
    });
  });
  Object.values(teamMap).forEach(t => {
    t.avgScore = t._tCount > 0 ? Math.round(t._tScore / t._tCount) : 0;
    delete t._tScore; delete t._tCount;
  });
  renderTeamBreakdown(Object.values(teamMap).sort((a, b) => b.totalLeads - a.totalLeads), true);
}

function renderTeamBreakdown(teams, isHubspot = false) {
  const tbody = document.getElementById('tbodyTeamBreakdown');
  if (!teams || !teams.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No teams data.</td></tr>';
    return;
  }
  tbody.innerHTML = teams.map(t => `<tr>
    <td style="font-weight:500">${escHtml(t.teamName)}</td>
    <td>${t.repCount}</td>
    <td><strong>${t.totalLeads}</strong></td>
    <td>${isHubspot ? scoreBar(t.avgScore) : '<span style="color:#8892aa">—</span>'}</td>
    <td><span style="color:#4f8ef7;font-weight:600">${t.categories?.['Core ICP'] || 0}</span></td>
    <td><span style="color:#22c55e;font-weight:600">${t.categories?.['Strong ICP'] || 0}</span></td>
    <td><span style="color:#ef4444;font-weight:600">${t.categories?.['Non ICP'] || 0}</span></td>
  </tr>`).join('');
}

function renderRepTopLeads(leads, isHubspot = false) {
  const tbody = document.getElementById('tbodyRepTopLeads');
  if (!leads || !leads.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">No high-priority leads yet.</td></tr>';
    return;
  }
  tbody.innerHTML = leads.slice(0, 20).map(l => `<tr>
    <td>
      <div style="font-weight:500">${escHtml(l.name || '—')}</div>
      <div style="font-size:12px;color:#8892aa">${escHtml(l.email || '')}</div>
    </td>
    <td style="color:#8892aa">${escHtml(l.companyName || '—')}</td>
    <td style="color:#8892aa;font-size:12px">${escHtml(l.jobTitle || '—')}</td>
    <td style="color:#8892aa">${escHtml(l.country || '—')}</td>
    <td style="color:#8892aa;font-size:12px">${isHubspot ? escHtml(l.ownerName || '—') : '—'}</td>
    <td style="font-size:12px">${escHtml(l.leadSource || '—')}</td>
    <td>${scoreBar(l.score)}</td>
    <td>${categoryBadge(l.category)}</td>
  </tr>`).join('');
}

async function viewUploadDetail(uploadId) {
  try {
    const data = await apiFetch(`/uploads/${uploadId}`);
    const u    = data.upload;
    switchView('pdf');
    fileLeads = u.leads;
    renderFileResults({ total: u.leadCount, stats: u.stats, enrichStats: { enriched: u.enrichedCount, total: u.leadCount }, leads: u.leads });
    renderEnrichBanner({ enriched: u.enrichedCount, total: u.leadCount });
    document.getElementById('pdfResults').classList.remove('hidden');
    showToast(`Viewing upload: ${u.filename} by ${u.repName}`);
  } catch (err) {
    showToast('Failed to load upload: ' + err.message);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  Manage Reps & Teams Modal
// ══════════════════════════════════════════════════════════════════════════════

function openRepModal() {
  document.getElementById('modalOverlay').classList.remove('hidden');
  renderModalContent();
}

function closeRepModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
}

function renderModalContent() {
  // Teams list
  const teamsList = document.getElementById('teamsList');
  teamsList.innerHTML = allTeams.length
    ? allTeams.map(t => `
      <div class="item-row">
        <span class="item-name">${escHtml(t.name)}</span>
        <button class="btn btn-danger" style="padding:4px 10px;font-size:11px" onclick="deleteTeamAction('${t.id}')">Delete</button>
      </div>`).join('')
    : '<div class="empty" style="padding:12px;font-size:13px">No teams yet</div>';

  // Team select in rep form
  const repTeamSel = document.getElementById('newRepTeam');
  repTeamSel.innerHTML = '<option value="">No Team</option>' +
    allTeams.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('');

  // Reps list
  const repsList = document.getElementById('repsList');
  repsList.innerHTML = allReps.length
    ? allReps.map(r => `
      <div class="item-row">
        <span class="item-name">${escHtml(r.name)} <span style="color:#8892aa;font-size:12px">${r.email ? '('+escHtml(r.email)+')' : ''} ${r.teamName ? '· '+escHtml(r.teamName) : ''}</span></span>
        <button class="btn btn-danger" style="padding:4px 10px;font-size:11px" onclick="deleteRepAction('${r.id}')">Delete</button>
      </div>`).join('')
    : '<div class="empty" style="padding:12px;font-size:13px">No reps yet</div>';
}

async function addTeamAction() {
  const input = document.getElementById('newTeamName');
  const name = input.value.trim();
  if (!name) return showToast('Enter a team name');
  try {
    await apiFetch('/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    input.value = '';
    await loadRepsAndTeams();
    renderModalContent();
    showToast('Team created');
  } catch (err) { showToast('Error: ' + err.message); }
}

async function deleteTeamAction(id) {
  if (!confirm('Delete this team?')) return;
  try {
    await apiFetch(`/teams/${id}`, { method: 'DELETE' });
    await loadRepsAndTeams();
    renderModalContent();
    showToast('Team deleted');
  } catch (err) { showToast('Error: ' + err.message); }
}

async function addRepAction() {
  const name   = document.getElementById('newRepName').value.trim();
  const email  = document.getElementById('newRepEmail').value.trim();
  const teamId = document.getElementById('newRepTeam').value;
  if (!name) return showToast('Enter a rep name');
  try {
    await apiFetch('/reps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, teamId })
    });
    document.getElementById('newRepName').value = '';
    document.getElementById('newRepEmail').value = '';
    await loadRepsAndTeams();
    renderModalContent();
    showToast('Rep added');
  } catch (err) { showToast('Error: ' + err.message); }
}

async function deleteRepAction(id) {
  if (!confirm('Delete this rep? Upload history will remain.')) return;
  try {
    await apiFetch(`/reps/${id}`, { method: 'DELETE' });
    await loadRepsAndTeams();
    renderModalContent();
    showToast('Rep deleted');
  } catch (err) { showToast('Error: ' + err.message); }
}

// ══════════════════════════════════════════════════════════════════════════════
//  HubSpot Pull (filter by date, lead source, lifecycle)
// ══════════════════════════════════════════════════════════════════════════════

let pullLeads = [];

// ══════════════════════════════════════════════════════════════════════════════
//  HubSpot Pull — State
// ══════════════════════════════════════════════════════════════════════════════

let hsOwners    = [];   // [{id, name, email, teams:[{id,name}]}]
let hsTeams     = [];   // [{id, name, userIds:[]}]
let hsLeadSrcs  = [];   // [{label, value}]
let hsMqlTypes  = [];   // [{label, value}]
let selectedLeadSources = new Set();
let ownerDatePreset = null;  // 'last_week' | 'last_month' | 'last_3months' | 'custom'
let hubspotPullViewReady = false;
let pdfViewReady = false;

async function loadHubspotPullView() {
  if (hubspotPullViewReady) return;  // already initialised — keep existing results
  await loadRepsAndTeams();

  // Populate internal rep selector
  const sel = document.getElementById('pullRepSelect');
  sel.innerHTML = '<option value="">— No Rep —</option>' +
    allReps.map(r => `<option value="${r.id}">${escHtml(r.name)}</option>`).join('');

  // Load owners, teams, lead sources, MQL types in parallel
  try {
    const [ownersData, teamsData, srcData, mqlData] = await Promise.allSettled([
      apiFetch('/hubspot/owners'),
      apiFetch('/hubspot/hs-teams'),
      apiFetch('/hubspot/property-options/lead_source'),   // CloudFuze custom lead source property
      apiFetch('/hubspot/property-options/mql_type')
    ]);

    if (ownersData.status === 'fulfilled') {
      hsOwners = ownersData.value.owners || [];
      populateOwnerDropdown();
    }
    if (teamsData.status === 'fulfilled') {
      hsTeams = teamsData.value.teams || [];
      populateTeamDropdown();
    }
    if (srcData.status === 'fulfilled') {
      hsLeadSrcs = srcData.value.options || [];
      renderLeadSourceGrid();
    }
    if (mqlData.status === 'fulfilled') {
      hsMqlTypes = mqlData.value.options || [];
      populateMqlTypeDropdown();
    }
  } catch (err) {
    console.warn('HubSpot meta load error:', err.message);
  }

  // Wire up team → filter owners
  document.getElementById('pullTeamSelect').addEventListener('change', filterOwnersByTeam);

  // Date preset buttons
  document.querySelectorAll('#ownerDatePresets .preset-btn').forEach(btn => {
    btn.addEventListener('click', () => applyOwnerDatePreset(btn.dataset.preset));
  });

  // Clear filters
  document.getElementById('btnClearPullFilters').addEventListener('click', clearPullFilters);


  // Download CSV
  const btnCSV = document.getElementById('btnPullDownloadCSV');
  if (btnCSV) btnCSV.addEventListener('click', downloadPullCSV);

  // Search
  const searchEl = document.getElementById('pullSearch');
  if (searchEl) searchEl.addEventListener('input', filterPullTable);

  // Select all checkbox
  const chkAll = document.getElementById('chkPullAll');
  if (chkAll) chkAll.addEventListener('change', e => {
    document.querySelectorAll('.pull-row-chk').forEach(c => c.checked = e.target.checked);
  });

  hubspotPullViewReady = true;
}

function populateOwnerDropdown() {
  const sel = document.getElementById('pullOwnerSelect');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All Owners</option>' +
    hsOwners.map(o => `<option value="${escHtml(o.id)}">${escHtml(o.name)}${o.email ? ' <'+escHtml(o.email)+'>' : ''}</option>`).join('');
  sel.value = cur;
}

function populateTeamDropdown() {
  const sel = document.getElementById('pullTeamSelect');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All Teams</option>' +
    hsTeams.map(t => `<option value="${escHtml(t.id)}">${escHtml(t.name)}</option>`).join('');
  sel.value = cur;
}

function filterOwnersByTeam() {
  const teamId = document.getElementById('pullTeamSelect').value;
  const sel    = document.getElementById('pullOwnerSelect');
  if (!teamId) {
    populateOwnerDropdown();
    return;
  }
  const team = hsTeams.find(t => t.id === teamId);
  const filtered = team ? hsOwners.filter(o => team.userIds.includes(o.id)) : hsOwners;
  sel.innerHTML = '<option value="">All in Team</option>' +
    filtered.map(o => `<option value="${escHtml(o.id)}">${escHtml(o.name)}</option>`).join('');
}

function populateMqlTypeDropdown() {
  const sel = document.getElementById('pullMqlType');
  if (!hsMqlTypes.length) return;
  sel.innerHTML = '<option value="">All MQL Types</option>' +
    hsMqlTypes.map(o => `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`).join('');
}

function renderLeadSourceGrid() {
  const grid = document.getElementById('leadSourceGrid');
  if (!hsLeadSrcs.length) {
    grid.innerHTML = '<span style="color:#8892aa;font-size:13px">No lead sources found in HubSpot.</span>';
    return;
  }
  grid.innerHTML = hsLeadSrcs.map(src => `
    <label class="ls-chip ${selectedLeadSources.has(src.value) ? 'ls-chip-active' : ''}" data-value="${escHtml(src.value)}">
      <input type="checkbox" class="ls-chk" value="${escHtml(src.value)}" ${selectedLeadSources.has(src.value) ? 'checked' : ''} />
      ${escHtml(src.label)}
    </label>`).join('');

  grid.querySelectorAll('.ls-chk').forEach(chk => {
    chk.addEventListener('change', () => {
      const chip = chk.closest('.ls-chip');
      if (chk.checked) {
        selectedLeadSources.add(chk.value);
        chip.classList.add('ls-chip-active');
      } else {
        selectedLeadSources.delete(chk.value);
        chip.classList.remove('ls-chip-active');
      }
    });
  });
}

function applyOwnerDatePreset(preset) {
  ownerDatePreset = preset;
  document.querySelectorAll('#ownerDatePresets .preset-btn').forEach(b => b.classList.toggle('preset-btn-active', b.dataset.preset === preset));
  const custom = document.getElementById('ownerDateCustom');
  custom.classList.toggle('hidden', preset !== 'custom');

  if (preset === 'custom') return;

  const now   = new Date();
  const from  = new Date();
  if (preset === 'last_week') {
    // Last full week (Mon–Sun)
    const day = now.getDay(); // 0=Sun
    const diff = day === 0 ? 6 : day - 1;
    from.setDate(now.getDate() - diff - 7);
    const to = new Date(from); to.setDate(from.getDate() + 6);
    document.getElementById('pullOwnerFrom').value = from.toISOString().split('T')[0];
    document.getElementById('pullOwnerTo').value   = to.toISOString().split('T')[0];
  } else if (preset === 'last_month') {
    from.setMonth(now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0);
    document.getElementById('pullOwnerFrom').value = from.toISOString().split('T')[0];
    document.getElementById('pullOwnerTo').value   = to.toISOString().split('T')[0];
  } else if (preset === 'last_3months') {
    from.setMonth(now.getMonth() - 3, 1);
    document.getElementById('pullOwnerFrom').value = from.toISOString().split('T')[0];
    document.getElementById('pullOwnerTo').value   = now.toISOString().split('T')[0];
  }
}

function clearPullFilters() {
  ownerDatePreset = null;
  selectedLeadSources.clear();
  document.querySelectorAll('#ownerDatePresets .preset-btn').forEach(b => b.classList.remove('preset-btn-active'));
  document.getElementById('ownerDateCustom').classList.add('hidden');
  document.getElementById('pullOwnerFrom').value = '';
  document.getElementById('pullOwnerTo').value   = '';
  document.getElementById('pullOwnerSelect').value = '';
  document.getElementById('pullTeamSelect').value  = '';
  document.getElementById('pullMqlType').value     = '';
  document.getElementById('pullLifecycle').value   = '';
  populateOwnerDropdown();
  renderLeadSourceGrid();
  showToast('Filters cleared');
}

async function pullAndScore() {
  const progress = document.getElementById('pullProgress');
  const results  = document.getElementById('pullResults');

  progress.classList.remove('hidden');
  results.classList.add('hidden');
  document.getElementById('pullProgressMsg').textContent = 'Pulling contacts from HubSpot…';

  try {
    const ownerAssignedFrom = document.getElementById('pullOwnerFrom').value || undefined;
    const ownerAssignedTo   = document.getElementById('pullOwnerTo').value   || undefined;
    const ownerId           = document.getElementById('pullOwnerSelect').value;
    const teamId            = document.getElementById('pullTeamSelect').value;
    const mqlType           = document.getElementById('pullMqlType').value;
    const lifecycleStage    = document.getElementById('pullLifecycle').value;
    const enrich            = document.getElementById('pullEnrich').checked;
    const repId             = document.getElementById('pullRepSelect').value;

    const leadSources = [...selectedLeadSources];

    const body = {
      ownerAssignedFrom, ownerAssignedTo,
      ownerIds:      ownerId ? [ownerId] : [],
      teamId:        teamId  || undefined,
      mqlType:       mqlType || undefined,
      lifecycleStage: lifecycleStage || undefined,
      leadSources,
      enrich,
      repId: repId || undefined
    };

    document.getElementById('pullProgressMsg').textContent = 'Enriching & scoring… this may take a few minutes';

    const data = await apiFetch('/hubspot/pull-and-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    progress.classList.add('hidden');
    pullLeads = data.leads;

    // Enrich banner
    const banner = document.getElementById('pullEnrichBanner');
    if (data.enrichStats) {
      banner.className = 'enrich-banner ' + (data.enrichStats.enriched > 0 ? 'success' : 'warn');
      banner.innerHTML = `<strong>Apollo Enrichment:</strong> ${data.enrichStats.enriched} of ${data.enrichStats.total} enriched` +
        (data.enrichStats.failed ? ` · ${data.enrichStats.failed} not found` : '') +
        (data.wroteBack ? ' · <strong>✅ Scores written to HubSpot</strong>' : '');
      banner.classList.remove('hidden');
    }

    // Stats cards
    const cats = [
      { label:'Total Pulled', value: data.total,                       cls:'card-blue'   },
      { label:'Core ICP',     value: data.stats['Core ICP']    || 0,   cls:'card-green'  },
      { label:'Strong ICP',   value: data.stats['Strong ICP']  || 0,   cls:'card-yellow' },
      { label:'Moderate ICP', value: data.stats['Moderate ICP']|| 0,   cls:'card-purple' },
      { label:'Non ICP',      value: data.stats['Non ICP']     || 0,   cls:'card-red'    }
    ];
    document.getElementById('pullStatsCards').innerHTML =
      cats.map(c => `<div class="card ${c.cls}"><div class="card-label">${c.label}</div><div class="card-value">${c.value}</div></div>`).join('');

    document.getElementById('pullResultCount').textContent = `${data.total} contacts pulled`;
    renderPullResults(data.leads);
    results.classList.remove('hidden');
    showToast(`Scored ${data.total} contacts` + (data.wroteBack ? ' — written to HubSpot!' : ''), 4000);
  } catch (err) {
    progress.classList.add('hidden');
    showToast('Pull failed: ' + err.message, 5000);
    console.error(err);
  }
}

function scoreBreakdownMini(bd) {
  if (!bd) return '—';
  const dims = [
    { key:'companySize', label:'Size',    max:35 },
    { key:'geography',   label:'Geo',     max:35 },
    { key:'industry',    label:'Ind',     max:10 },
    { key:'technology',  label:'Tech',    max:10 },
    { key:'buyerFit',    label:'Buyer',   max:10 }
  ];
  return `<div class="breakdown-row">${dims.map(d => {
    const val = bd[d.key] ?? 0;
    const pct = Math.round((val / d.max) * 100);
    const col = pct >= 80 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
    return `<div class="breakdown-dim">
      <div class="breakdown-label">${d.label}</div>
      <div class="breakdown-track"><div class="breakdown-fill" style="width:${pct}%;background:${col}"></div></div>
      <div class="breakdown-val">${val}</div>
    </div>`;
  }).join('')}</div>`;
}

function renderPullResults(contacts) {
  const tbody = document.getElementById('tbodyPull');
  if (!contacts || !contacts.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty">No contacts found. Adjust filters and try again.</td></tr>';
    return;
  }
  tbody.innerHTML = contacts.map((l, i) => {
    const ownerTeam  = l.ownerTeams || '—';
    const src        = l.leadSource ? l.leadSource.replace(/_/g,' ') : '—';
    const destCloud  = l.typeOfDestination || l.destinationCloud || '—';
    const srcCloud   = l.sourceCloud || '—';
    return `<tr data-idx="${i}">
      <td><input type="checkbox" class="pull-row-chk" data-idx="${i}" /></td>
      <td style="cursor:pointer" onclick="showLeadDetail(pullLeads[${i}])">
        <div style="font-weight:500;color:var(--blue-light,#2d5ce6)">${escHtml(l.name||'—')}</div>
        <div style="font-size:12px;color:var(--muted)">${escHtml(l.email||'')}</div>
        ${l.jobTitle ? `<div style="font-size:11px;color:#6b7280">${escHtml(l.jobTitle)}</div>` : ''}
      </td>
      <td>
        <div style="font-weight:500;font-size:13px">${escHtml(l.ownerName||'—')}</div>
        ${l.ownerEmail ? `<div style="font-size:11px;color:#8892aa">${escHtml(l.ownerEmail)}</div>` : ''}
      </td>
      <td style="color:#8892aa;font-size:13px">${escHtml(ownerTeam)}</td>
      <td><span class="badge badge-source">${escHtml(src)}</span></td>
      <td style="color:#8892aa;font-size:12px">${escHtml(l.mqlType||'—')}</td>
      <td>
        ${srcCloud !== '—' ? `<div style="font-size:11px;color:#8892aa">From: <span style="color:#f59e0b">${escHtml(srcCloud)}</span></div>` : ''}
        <div style="font-size:12px;font-weight:500;color:${destCloud!=='—'?'#22c55e':'#8892aa'}">${escHtml(destCloud)}</div>
      </td>
      <td style="color:#8892aa;font-size:12px">${formatDate(l.ownerAssignedDate)}</td>
      <td>${scoreBar(l.score)}</td>
      <td>${scoreBreakdownMini(l.breakdown)}</td>
      <td>${categoryBadge(l.category)}</td>
      <td>${priorityBadge(l.priority)}</td>
    </tr>`;
  }).join('');
}

function filterPullTable() {
  const q = (document.getElementById('pullSearch')?.value || '').toLowerCase();
  const rows = document.querySelectorAll('#tbodyPull tr[data-idx]');
  rows.forEach(row => {
    row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

function downloadPullCSV() {
  if (!pullLeads || !pullLeads.length) { showToast('No data to export'); return; }
  const headers = ['Name','Email','Job Title','Company','Owner','Team','Lead Source','MQL Type','Source Cloud','Destination Cloud','Owner Assigned Date','Created Date','Employees','Country','Industry','Score','Size Score','Geo Score','Industry Score','Tech Score (Dest Cloud)','Buyer Score','Category','Priority'];
  const rows = pullLeads.map(l => [
    l.name || '', l.email || '', l.jobTitle || '', l.companyName || '',
    l.ownerName || '', l.ownerTeams || '',
    l.leadSource || '', l.mqlType || '',
    l.sourceCloud || '', l.typeOfDestination || l.destinationCloud || '',
    l.ownerAssignedDate || '', l.createdDate || '',
    l.numberOfEmployees || '', l.country || '', l.industry || '',
    l.score ?? '',
    l.breakdown?.companySize ?? '', l.breakdown?.geography ?? '',
    l.breakdown?.industry ?? '', l.breakdown?.technology ?? '', l.breakdown?.buyerFit ?? '',
    l.category || '', l.priority || ''
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'hubspot_icp_scored.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV downloaded');
}

// ══════════════════════════════════════════════════════════════════════════════
//  Contacts
// ══════════════════════════════════════════════════════════════════════════════

async function loadContacts() {
  const tbody = document.getElementById('tbodyContacts');
  tbody.innerHTML = '<tr><td colspan="6" class="empty"><div class="spinner" style="margin:auto"></div></td></tr>';
  try {
    const data  = await apiFetch('/contacts');
    allContacts = data.contacts;
    renderContactsTable(allContacts);
    document.getElementById('contactsMeta').textContent = `${data.total} contacts`;
  } catch (err) { tbody.innerHTML = `<tr><td colspan="6" class="empty">Error: ${escHtml(err.message)}</td></tr>`; }
}

function renderContactsTable(contacts) {
  const tbody = document.getElementById('tbodyContacts');
  if (!contacts.length) { tbody.innerHTML = '<tr><td colspan="6" class="empty">No contacts match your filter.</td></tr>'; return; }
  tbody.innerHTML = contacts.map(c => `<tr>
    <td><div style="font-weight:500">${escHtml(c.name||'—')}</div><div style="font-size:12px;color:#8892aa">${escHtml(c.email||'')}</div></td>
    <td style="color:#8892aa">${escHtml(c.title||'—')}</td>
    <td style="color:#8892aa">${escHtml(c.country||'—')}</td>
    <td>${scoreBar(c.score)}</td>
    <td>${categoryBadge(c.category)}</td>
    <td>${priorityBadge(c.priority)}</td>
  </tr>`).join('');
  document.getElementById('contactsMeta').textContent = `Showing ${contacts.length} contacts`;
}

function getContactSegment(c) {
  return (c.size_of_business && c.size_of_business.trim()) ? c.size_of_business.trim() : 'Others';
}

function filterContacts() {
  const q       = document.getElementById('contactSearch').value.toLowerCase();
  const cat     = document.getElementById('filterCategory').value;
  const seg     = document.getElementById('filterSegment').value;
  const dateFrom = document.getElementById('filterDateFrom').value;
  const dateTo   = document.getElementById('filterDateTo').value;

  renderContactsTable(allContacts.filter(c => {
    if (q && !(c.name||'').toLowerCase().includes(q) && !(c.email||'').toLowerCase().includes(q)) return false;
    if (cat && c.category !== cat) return false;
    if (seg && getContactSegment(c) !== seg) return false;
    if (dateFrom && c.create_date && c.create_date < dateFrom) return false;
    if (dateTo   && c.create_date && c.create_date > dateTo)   return false;
    return true;
  }));
}

// ══════════════════════════════════════════════════════════════════════════════
//  Run Scoring (HubSpot)
// ══════════════════════════════════════════════════════════════════════════════

async function runScoringAll() {
  const btn      = document.getElementById('btnScoreAllBig');
  const progress = document.getElementById('scoreProgress');
  const result   = document.getElementById('scoreResult');
  if (btn) btn.disabled = true;
  progress.classList.remove('hidden');
  result.classList.add('hidden');
  document.getElementById('scoreProgressMsg').textContent = 'Re-scoring cached contacts…';
  try {
    const data = await apiFetch('/sync/rescore', { method: 'POST' });
    progress.classList.add('hidden');
    result.className = 'score-result success';
    result.innerHTML = `<strong>Done!</strong> ${data.rescored} contacts re-scored locally.`;
    result.classList.remove('hidden');
    showToast(`Re-scored ${data.rescored} contacts`);
  } catch (err) {
    progress.classList.add('hidden');
    result.className  = 'score-result error';
    result.textContent = 'Error: ' + err.message;
    result.classList.remove('hidden');
    showToast('Re-scoring failed: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  File Upload & Analyze
// ══════════════════════════════════════════════════════════════════════════════

function initFileUpload() {
  const zone   = document.getElementById('uploadZone');
  const input  = document.getElementById('fileInput');
  const label  = document.getElementById('uploadFilename');
  const btnA   = document.getElementById('btnAnalyze');
  const btnB   = document.getElementById('btnBrowse');

  const ALLOWED_EXTS = ['.csv', '.xls', '.xlsx'];
  function isAllowed(filename) {
    return ALLOWED_EXTS.some(ext => filename.toLowerCase().endsWith(ext));
  }

  zone.addEventListener('click', () => input.click());
  btnB.addEventListener('click', e => { e.stopPropagation(); input.click(); });

  input.addEventListener('change', () => {
    if (input.files[0]) setFile(input.files[0]);
  });

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragging'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragging');
    const file = e.dataTransfer.files[0];
    if (file && isAllowed(file.name)) setFile(file);
    else showToast('Please drop a CSV or Excel file (.csv, .xls, .xlsx)');
  });

  function setFile(file) {
    label.textContent = `${file.name} (${(file.size/1024).toFixed(0)} KB)`;
    zone.classList.add('has-file');
    btnA.disabled = false;
    input._file   = file;
  }

  btnA.addEventListener('click', () => analyzeFile(input._file));
}

async function analyzeFile(file) {
  if (!file) return;
  const btn      = document.getElementById('btnAnalyze');
  const progress = document.getElementById('pdfProgress');
  const errEl    = document.getElementById('pdfError');
  const results  = document.getElementById('pdfResults');
  const enrichOn = document.getElementById('chkEnrich')?.checked !== false;
  const repId    = document.getElementById('uploadRepSelect')?.value || '';

  btn.disabled = true;
  progress.classList.remove('hidden');
  errEl.classList.add('hidden');
  results.classList.add('hidden');

  const progressMsg = document.getElementById('pdfProgressMsg');
  if (enrichOn) {
    progressMsg.textContent = 'Uploading file & enriching leads via Apollo… this may take a moment';
  } else {
    progressMsg.textContent = 'Processing file…';
  }

  try {
    const formData = new FormData();
    formData.append('file', file);

    const enrichParam = enrichOn ? 'true' : 'false';
    let url = `${API}/file/analyze?enrich=${enrichParam}`;
    if (repId) url += `&repId=${encodeURIComponent(repId)}`;

    const res = await fetch(url, { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message);

    progress.classList.add('hidden');
    fileLeads = data.leads;
    renderFileResults(data);
    renderEnrichBanner(data.enrichStats);
    results.classList.remove('hidden');

    const enrichMsg = data.enrichStats?.enriched
      ? ` (${data.enrichStats.enriched} enriched via Apollo)`
      : '';
    const repMsg = repId ? ' — tracked for rep' : '';
    showToast(`Scored ${data.total} leads${enrichMsg}${repMsg}`, 4000);
  } catch (err) {
    progress.classList.add('hidden');
    errEl.className = 'score-result error';
    errEl.textContent = 'Import failed: ' + err.message;
    errEl.classList.remove('hidden');
    showToast('Import failed: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

function renderEnrichBanner(enrichStats) {
  const banner = document.getElementById('enrichBanner');
  if (!enrichStats) { banner.style.display = 'none'; return; }

  if (enrichStats.skipped) {
    banner.style.display = 'block';
    banner.className = 'enrich-banner warn';
    banner.innerHTML = `<strong>Apollo enrichment skipped:</strong> ${escHtml(enrichStats.reason)}. Add APOLLO_API_KEY to your .env file to enable auto-enrichment.`;
    return;
  }

  if (enrichStats.enriched > 0 || enrichStats.failed > 0) {
    banner.style.display = 'block';
    banner.className = 'enrich-banner success';
    banner.innerHTML = `<strong>Apollo Enrichment:</strong> ${enrichStats.enriched} of ${enrichStats.total} leads enriched successfully` +
      (enrichStats.failed ? ` · ${enrichStats.failed} not found` : '') +
      (enrichStats.error ? ` · Error: ${escHtml(enrichStats.error)}` : '');
    return;
  }

  banner.style.display = 'none';
}

function downloadCSV() {
  if (!fileLeads.length) return;
  const headers = ['Name','Email','Company','Job Title','Employees','Country','Industry',
    'Source Platform','Destination Platform','Size of Business','Phone','Created Date',
    'Score','Category','Priority',
    'Company Size Score','Company Size Reason','Geography Score','Geography Reason',
    'Industry Score','Industry Reason','Migration Score','Migration Reason',
    'Buyer Fit Score','Buyer Fit Reason'];
  const rows = fileLeads.map(l => [
    l.name || '', l.email || '', l.companyName || '', l.jobTitle || '',
    l.numberOfEmployees || '', l.country || '', l.industry || '',
    l.sourceCloud || '', l.destinationCloud || l.typeOfDestination || l.techStack || '',
    l.sizeOfBusiness || '', l.phone || '', l.createdDate || '',
    l.score ?? '', l.category || '', l.priority || '',
    l.breakdown?.companySize ?? '', l.reasons?.companySize || '',
    l.breakdown?.geography ?? '', l.reasons?.geography || '',
    l.breakdown?.industry ?? '', l.reasons?.industry || '',
    l.breakdown?.technology ?? '', l.reasons?.technology || '',
    l.breakdown?.buyerFit ?? '', l.reasons?.buyerFit || ''
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'icp_scored_leads.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV downloaded');
}

async function downloadExcel() {
  if (!fileLeads.length) { showToast('No data to export'); return; }
  try {
    showToast('Generating Excel file…');
    const res = await fetch(`${API}/file/download-excel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leads: fileLeads, filename: 'icp_scored_leads' })
    });
    if (!res.ok) throw new Error('Failed to generate Excel');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'icp_scored_leads.xlsx';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Excel downloaded');
  } catch (err) {
    showToast('Excel download failed: ' + err.message);
  }
}

function renderFileResults(data) {
  // Stats cards
  const statsEl = document.getElementById('pdfStatsCards');
  const enriched = data.enrichStats?.enriched || 0;
  const cats = [
    { label:'Total Imported',    value: data.total,                          cls: 'card-blue'   },
    { label:'Enriched (Apollo)', value: enriched,                            cls: 'card-indigo' },
    { label:'Core ICP',          value: data.stats['Core ICP']     || 0,    cls: 'card-green'  },
    { label:'Strong ICP',        value: data.stats['Strong ICP']   || 0,    cls: 'card-yellow' },
    { label:'Moderate ICP',      value: data.stats['Moderate ICP'] || 0,    cls: 'card-purple' },
    { label:'Non ICP',           value: data.stats['Non ICP']      || 0,    cls: 'card-red'    }
  ];
  statsEl.innerHTML = cats.map(c => `
    <div class="card ${c.cls}">
      <div class="card-label">${c.label}</div>
      <div class="card-value">${c.value}</div>
    </div>`).join('');

  // Table
  const tbody = document.getElementById('tbodyFile');
  if (!data.leads.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">No leads found in this file.</td></tr>';
    return;
  }
  tbody.innerHTML = data.leads.map(l => `<tr>
    <td>
      <div style="font-weight:500">${escHtml(l.name||'—')}</div>
      <div style="font-size:12px;color:#8892aa">${escHtml(l.email||'')}</div>
    </td>
    <td style="color:#8892aa">${escHtml(l.companyName||'—')}</td>
    <td style="color:#8892aa">${escHtml(l.jobTitle||'—')}</td>
    <td style="color:#8892aa">${l.numberOfEmployees ? Number(l.numberOfEmployees).toLocaleString() : '—'}</td>
    <td style="color:#8892aa">${escHtml(l.country||'—')}</td>
    <td style="color:#8892aa;font-size:12px">${escHtml(l.industry||'—')}</td>
    <td style="color:#8892aa;font-size:12px">${formatDate(l.createdDate)}</td>
    <td>${scoreBar(l.score)}</td>
    <td>${categoryBadge(l.category)}</td>
    <td>${priorityBadge(l.priority)}</td>
  </tr>`).join('');
}

// ══════════════════════════════════════════════════════════════════════════════
//  ADMIN PANEL
// ══════════════════════════════════════════════════════════════════════════════

async function loadAdminConfig() {
  try {
    const data = await apiFetch('/admin/config');
    adminConfig = data.config;
    renderAdminTab(activeAdminTab);
  } catch (err) {
    document.getElementById('adminTabContent').innerHTML =
      `<div class="score-result error" style="margin:0">${escHtml(err.message)}</div>`;
  }
}

function renderAdminTab(tab) {
  activeAdminTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const el = document.getElementById('adminTabContent');
  if (!adminConfig) return;

  switch (tab) {
    case 'companySize': el.innerHTML = renderCompanySize();     break;
    case 'geography':   el.innerHTML = renderGeoAdmin();        break;
    case 'industry':    el.innerHTML = renderKeywordsAdmin('industry',   'Industry',    { tier1:'IT / Software (10pts)', tier2:'Finance / Health (8pts)', tier3:'Education (6pts)', other:'Other Detected (4pts)', none:'Not Detected (0pts)' });   break;
    case 'technology':  el.innerHTML = renderKeywordsAdmin('technology', 'Migration Platform',  { tier1:'Google / Microsoft (10pts)', tier2:'Dropbox / Box / Egnyte… (8pts)', tier3:'Not Provided (5pts)', none:'Both Unsupported (0pts)' }); break;
    case 'buyerFit':    el.innerHTML = renderKeywordsAdmin('buyerFit',   'Buyer Fit',   { tier1:'C-Level / IT Leadership (10pts)', tier2:'IT Manager / Admin (7pts)', tier3:'Consultant / Freelance (5pts)', other:'Non-IT Role (5pts)', none:'No Title (0pts)' });  break;
    case 'categories':  el.innerHTML = renderCategories();      break;
  }
}

function renderCompanySize() {
  const rows = adminConfig.companySize.map((tier, i) => `
    <tr data-cs-index="${i}">
      <td><input class="admin-input" type="text" data-field="label" value="${escHtml(tier.label)}" /></td>
      <td><input class="admin-input" type="number" data-field="minEmployees" value="${tier.minEmployees}" min="0" style="width:90px" /></td>
      <td><input class="admin-input" type="number" data-field="maxEmployees" value="${tier.maxEmployees ?? ''}" placeholder="∞" style="width:90px" /></td>
      <td><input class="admin-input" type="number" data-field="score" value="${tier.score}" min="0" max="100" style="width:80px" /></td>
    </tr>`).join('');

  return `<div class="admin-section">
    <div class="admin-section-title">Company Size Tiers</div>
    <p class="admin-help">Set the employee count thresholds and score for each tier. Leave "Max" empty for unlimited.</p>
    <table class="admin-table">
      <thead><tr><th>Label</th><th>Min Employees</th><th>Max Employees</th><th>Score</th></tr></thead>
      <tbody id="csTbody">${rows}</tbody>
    </table>
  </div>`;
}

function renderGeoAdmin() {
  const { tier1, tier2, other } = adminConfig.geography;
  return `<div class="admin-section">
    <div class="admin-section-title">Geography Scoring</div>
    <p class="admin-help">Enter country names, one per line. Matching is case-insensitive.</p>
    ${renderGeoTier('geo-t1', 'Tier 1 — US / Canada / UK', tier1.score, tier1.countries.join('\n'))}
    ${renderGeoTier('geo-t2', 'Tier 2 — Europe / Australia / India', tier2.score, tier2.countries.join('\n'))}
    <div class="tier-block">
      <div class="tier-header">
        <span class="tier-label">Other Regions</span>
        <div class="tier-score-wrap">Score: <input class="tier-score-input" id="geo-other-score" type="number" value="${other.score}" /></div>
      </div>
    </div>
  </div>`;
}

function renderGeoTier(id, label, score, countries) {
  return `<div class="tier-block">
    <div class="tier-header">
      <span class="tier-label">${escHtml(label)}</span>
      <div class="tier-score-wrap">Score: <input class="tier-score-input" id="${id}-score" type="number" value="${score}" /></div>
    </div>
    <textarea class="keywords-area" id="${id}-countries" rows="4">${escHtml(countries)}</textarea>
    <div class="keywords-hint">One country per line</div>
  </div>`;
}

function renderKeywordsAdmin(dimension, title, tierLabels) {
  const dim    = adminConfig[dimension];
  const tiers  = Object.keys(tierLabels);
  const blocks = tiers.map(t => {
    const tier = dim[t];
    if (!tier) return '';
    const hasKeywords = Array.isArray(tier.keywords);
    return `<div class="tier-block">
      <div class="tier-header">
        <span class="tier-label">${escHtml(tierLabels[t])}</span>
        <div class="tier-score-wrap">Score: <input class="tier-score-input" id="${dimension}-${t}-score" type="number" value="${tier.score}" /></div>
      </div>
      ${hasKeywords ? `
        <textarea class="keywords-area" id="${dimension}-${t}-keywords">${escHtml(tier.keywords.join(', '))}</textarea>
        <div class="keywords-hint">Comma-separated keywords (case-insensitive)</div>
      ` : ''}
    </div>`;
  }).join('');

  return `<div class="admin-section">
    <div class="admin-section-title">${escHtml(title)} Tier Keywords</div>
    <p class="admin-help">Enter keywords that identify each tier. A lead matches a tier if any keyword is found in the relevant field.</p>
    ${blocks}
  </div>`;
}

function renderCategories() {
  const rows = adminConfig.categories.map((cat, i) => `
    <tr data-cat-index="${i}">
      <td><input class="admin-input" type="text" data-field="label" value="${escHtml(cat.label)}" /></td>
      <td><input class="admin-input" type="text" data-field="priority" value="${escHtml(cat.priority)}" /></td>
      <td><input class="admin-input" type="number" data-field="min" value="${cat.min}" min="0" max="100" style="width:80px" /></td>
      <td><input class="admin-input" type="number" data-field="max" value="${cat.max}" min="0" max="100" style="width:80px" /></td>
    </tr>`).join('');

  return `<div class="admin-section">
    <div class="admin-section-title">ICP Category Thresholds</div>
    <p class="admin-help">Set the score range for each ICP category. Ranges should not overlap and should collectively cover 0–100.</p>
    <table class="admin-table">
      <thead><tr><th>Category Label</th><th>Priority Label</th><th>Min Score</th><th>Max Score</th></tr></thead>
      <tbody id="catTbody">${rows}</tbody>
    </table>
  </div>`;
}

function collectAdminConfig() {
  const cfg = JSON.parse(JSON.stringify(adminConfig));

  document.querySelectorAll('#csTbody tr[data-cs-index]').forEach(row => {
    const i   = parseInt(row.dataset.csIndex);
    const get = field => row.querySelector(`[data-field="${field}"]`)?.value;
    cfg.companySize[i].label        = get('label');
    cfg.companySize[i].minEmployees = parseInt(get('minEmployees')) || 0;
    const mx = get('maxEmployees');
    cfg.companySize[i].maxEmployees = mx === '' ? null : parseInt(mx);
    cfg.companySize[i].score        = parseInt(get('score')) || 0;
  });

  const geoT1Score = document.getElementById('geo-t1-score');
  const geoT2Score = document.getElementById('geo-t2-score');
  const geoOScore  = document.getElementById('geo-other-score');
  const geoT1C     = document.getElementById('geo-t1-countries');
  const geoT2C     = document.getElementById('geo-t2-countries');
  if (geoT1Score) {
    cfg.geography.tier1.score     = parseInt(geoT1Score.value) || 0;
    cfg.geography.tier1.countries = (geoT1C?.value || '').split('\n').map(s=>s.trim()).filter(Boolean);
    cfg.geography.tier2.score     = parseInt(geoT2Score?.value) || 0;
    cfg.geography.tier2.countries = (geoT2C?.value || '').split('\n').map(s=>s.trim()).filter(Boolean);
    cfg.geography.other.score     = parseInt(geoOScore?.value) || 0;
  }

  ['industry','technology','buyerFit'].forEach(dim => {
    const tierKeys = Object.keys(cfg[dim]);
    tierKeys.forEach(t => {
      const scoreEl   = document.getElementById(`${dim}-${t}-score`);
      const kwEl      = document.getElementById(`${dim}-${t}-keywords`);
      if (scoreEl) cfg[dim][t].score = parseInt(scoreEl.value) || 0;
      if (kwEl && cfg[dim][t].keywords) {
        cfg[dim][t].keywords = kwEl.value.split(',').map(k=>k.trim()).filter(Boolean);
      }
    });
  });

  document.querySelectorAll('#catTbody tr[data-cat-index]').forEach(row => {
    const i   = parseInt(row.dataset.catIndex);
    const get = field => row.querySelector(`[data-field="${field}"]`)?.value;
    cfg.categories[i].label    = get('label');
    cfg.categories[i].priority = get('priority');
    cfg.categories[i].min      = parseInt(get('min')) || 0;
    cfg.categories[i].max      = parseInt(get('max')) || 0;
  });

  return cfg;
}

async function saveAdminConfig() {
  const btn    = document.getElementById('btnSaveConfig');
  const result = document.getElementById('adminResult');
  btn.disabled = true;
  result.classList.add('hidden');

  try {
    const cfg = collectAdminConfig();
    const saveResp = await apiFetch('/admin/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    });
    adminConfig = cfg;
    result.className = 'score-result success';
    const rescoreMsg = saveResp.rescored > 0
      ? ` ${saveResp.rescored} stored HubSpot leads re-scored automatically.`
      : '';
    result.textContent = 'Scoring config saved!' + rescoreMsg;
    result.classList.remove('hidden');
    showToast(saveResp.rescored > 0 ? `Config saved · ${saveResp.rescored} leads re-scored` : 'Config saved', 4000);
  } catch (err) {
    result.className = 'score-result error';
    result.textContent = 'Save failed: ' + err.message;
    result.classList.remove('hidden');
    showToast('Save failed: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

async function resetAdminConfig() {
  if (!confirm('Reset all scoring rules to factory defaults? This cannot be undone.')) return;
  const result = document.getElementById('adminResult');
  try {
    const data = await apiFetch('/admin/reset', { method: 'POST' });
    adminConfig = data.config;
    renderAdminTab(activeAdminTab);
    result.className = 'score-result success';
    result.textContent = 'Config reset to defaults.';
    result.classList.remove('hidden');
    showToast('Config reset to defaults');
  } catch (err) {
    result.className = 'score-result error';
    result.textContent = 'Reset failed: ' + err.message;
    result.classList.remove('hidden');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  Setup View
// ══════════════════════════════════════════════════════════════════════════════

async function runSetup() {
  const btn = document.getElementById('btnSetup'), progress = document.getElementById('setupProgress'), result = document.getElementById('setupResult');
  btn.disabled = true; progress.classList.remove('hidden'); result.classList.add('hidden');
  try {
    const data = await apiFetch('/setup', { method: 'POST' });
    progress.classList.add('hidden');
    const r = data.result;
    result.className = 'score-result success';
    result.innerHTML = `<strong>Done!</strong><br/>Created: ${r.created.join(', ')||'none'}<br/>Skipped: ${r.skipped.join(', ')||'none'}`;
    result.classList.remove('hidden');
    showToast('HubSpot properties ready');
  } catch (err) {
    progress.classList.add('hidden');
    result.className = 'score-result error'; result.textContent = 'Failed: ' + err.message; result.classList.remove('hidden');
  } finally { btn.disabled = false; }
}

async function runConnectionTest() {
  const btn = document.getElementById('btnTestConn'), result = document.getElementById('connResult');
  btn.disabled = true; result.classList.add('hidden');
  try {
    await apiFetch('/status');
    result.className = 'score-result success'; result.textContent = 'Connection successful!'; result.classList.remove('hidden');
    checkConnection();
  } catch (err) {
    result.className = 'score-result error'; result.textContent = 'Failed: ' + err.message; result.classList.remove('hidden');
    checkConnection();
  } finally { btn.disabled = false; }
}

// ══════════════════════════════════════════════════════════════════════════════
//  Boot
// ══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {

  // Navigation
  document.querySelectorAll('.nav-item').forEach(el =>
    el.addEventListener('click', e => { e.preventDefault(); switchView(el.dataset.view); })
  );

  // Topbar
  document.getElementById('btnRefresh').addEventListener('click', () => {
    const v = document.querySelector('.view.active')?.id?.replace('view-','');
    if (v === 'dashboard') loadDashboard();
    else if (v === 'contacts') loadContacts();
    else if (v === 'admin') loadAdminConfig();
    else if (v === 'rep-tracker') loadRepTracker();
    else if (v === 'hubspot-pull') loadHubspotPullView();
    else checkConnection();
  });

  document.getElementById('btnScoreAllBig').addEventListener('click', runScoringAll);

  // Contacts
  document.getElementById('contactSearch').addEventListener('input', filterContacts);
  document.getElementById('filterCategory').addEventListener('change', filterContacts);
  document.getElementById('filterSegment').addEventListener('change', filterContacts);

  // File Upload
  initFileUpload();
  document.getElementById('btnDownloadCSV').addEventListener('click', downloadCSV);
  const btnExcel = document.getElementById('btnDownloadExcel');
  if (btnExcel) btnExcel.addEventListener('click', downloadExcel);

  // HubSpot Pull
  document.getElementById('btnPullAndScore').addEventListener('click', pullAndScore);

  // Rep Tracker filters
  // Note: repFilterPeriod uses onchange="onRepPeriodChange()" in HTML — no duplicate listener here
  document.getElementById('repFilterTeam').addEventListener('change', loadRepTracker);
  document.getElementById('btnManageReps').addEventListener('click', openRepModal);

  // Modal
  document.getElementById('btnCloseModal').addEventListener('click', closeRepModal);
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target.id === 'modalOverlay') closeRepModal();
  });
  document.getElementById('btnAddTeam').addEventListener('click', addTeamAction);
  document.getElementById('btnAddRep').addEventListener('click', addRepAction);

  // Admin
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => renderAdminTab(btn.dataset.tab))
  );
  document.getElementById('btnSaveConfig').addEventListener('click', saveAdminConfig);
  document.getElementById('btnResetConfig').addEventListener('click', resetAdminConfig);

  // Setup
  document.getElementById('btnSetup').addEventListener('click', runSetup);
  document.getElementById('btnTestConn').addEventListener('click', runConnectionTest);

  // Sync button
  document.getElementById('btnSyncHubspot').addEventListener('click', syncHubspot);

  // Lead popup modal
  document.getElementById('btnCloseLeadPopup').addEventListener('click', closeLeadPopup);
  document.getElementById('leadPopupOverlay').addEventListener('click', e => {
    if (e.target.id === 'leadPopupOverlay') closeLeadPopup();
  });
  // Lead detail modal
  document.getElementById('btnCloseLeadDetail').addEventListener('click', closeLeadDetail);
  document.getElementById('leadDetailOverlay').addEventListener('click', e => {
    if (e.target.id === 'leadDetailOverlay') closeLeadDetail();
  });

  // Logout
  document.getElementById('btnLogout').addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_) {}
    window.location.href = '/login';
  });

  // Initial load
  checkConnection();
  loadSyncStatus();
  loadDashboard();
});

// ══════════════════════════════════════════════════════════════════════════════
//  Lead Detail Popup (chart click-through)
// ══════════════════════════════════════════════════════════════════════════════

function showLeadPopup(title, leads) {
  const overlay = document.getElementById('leadPopupOverlay');
  document.getElementById('leadPopupTitle').textContent = title;
  document.getElementById('leadPopupCount').textContent = `${leads.length} leads`;

  const tbody = document.getElementById('leadPopupBody');
  if (!leads.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">No leads in this segment</td></tr>';
  } else {
    window._popupLeads = leads.slice(0, 200);
    tbody.innerHTML = window._popupLeads.map((l, i) => `
      <tr style="cursor:pointer" onclick="showLeadDetail(window._popupLeads[${i}])">
        <td><div style="font-weight:500">${escHtml(l.name || '—')}</div><div style="font-size:11px;color:var(--muted)">${escHtml(l.email || '')}</div></td>
        <td style="font-size:12px">${escHtml(l.company || l.companyName || '—')}</td>
        <td style="font-size:12px">${escHtml(l.ownerName || '—')}</td>
        <td>${l.score != null ? scoreBar(l.score) : '—'}</td>
        <td>${categoryBadge(l.category)}</td>
        <td><span style="font-size:11px;color:var(--purple)">${escHtml(l.leadSource || '—')}</span></td>
        <td style="font-size:11px">${escHtml(l.destinationCloud || l.typeOfDestination || '—')}</td>
        <td style="font-size:11px;color:var(--blue-light,#2d5ce6)">View</td>
      </tr>
    `).join('');
  }
  overlay.classList.remove('hidden');
}

function closeLeadPopup() {
  document.getElementById('leadPopupOverlay').classList.add('hidden');
}

function filterLeadsByCategory(category) {
  const leads = window._repAllLeads || [];
  const filtered = leads.filter(l => l.category === category);
  showLeadPopup(category + ' Leads', filtered);
}

function filterLeadsByOwner(ownerName) {
  const leads = window._repAllLeads || [];
  const filtered = leads.filter(l => l.ownerName === ownerName);
  showLeadPopup(ownerName + ' — All Leads', filtered);
}

function filterLeadsByScoreRange(min, max) {
  const leads = window._repAllLeads || [];
  const filtered = leads.filter(l => l.score != null && l.score >= min && l.score <= max);
  showLeadPopup(`Score ${min}–${max}`, filtered);
}

// ── Lead Detail with full ICP Breakdown ─────────────────────────────────────

function showLeadDetail(lead) {
  if (!lead) return;
  const overlay = document.getElementById('leadDetailOverlay');
  document.getElementById('leadDetailName').textContent = lead.name || 'Unknown';
  document.getElementById('leadDetailEmail').textContent = lead.email || '';

  const score = lead.score ?? 0;
  const cat = lead.category || 'Unscored';
  const bd = lead.breakdown || {};

  let scoreColor = '#ef4444';
  if (score >= 80) scoreColor = '#2d5ce6';
  else if (score >= 65) scoreColor = '#65bc7b';
  else if (score >= 50) scoreColor = '#f59e0b';

  const reasons = lead.reasons || {};
  const dims = [
    { key: 'companySize', label: 'Company Size', max: 35, color: '#2d5ce6',
      reason: reasons.companySize || (lead.numberOfEmployees ? lead.numberOfEmployees + ' employees' : '—') },
    { key: 'geography', label: 'Geography', max: 35, color: '#14cfc3',
      reason: reasons.geography || lead.country || '—' },
    { key: 'industry', label: 'Industry', max: 10, color: '#6239bd',
      reason: reasons.industry || lead.industry || '—' },
    { key: 'technology', label: 'Migration Platform', max: 10, color: '#65bc7b',
      reason: reasons.technology || [lead.sourceCloud, lead.destinationCloud || lead.typeOfDestination || lead.techStack].filter(Boolean).join(' → ') || '—' },
    { key: 'buyerFit', label: 'Buyer Fit', max: 10, color: '#f59e0b',
      reason: reasons.buyerFit || lead.jobTitle || '—' }
  ];

  const body = document.getElementById('leadDetailBody');
  body.innerHTML = `
    <div class="icp-breakdown-card">
      <div class="icp-total-row">
        <div class="icp-total-score" style="color:${scoreColor}">${score}</div>
        <div class="icp-total-meta">
          <div>${categoryBadge(cat)} ${priorityBadge(lead.priority)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">out of 100 points</div>
        </div>
      </div>
      ${dims.map(d => {
        const val = bd[d.key] ?? 0;
        const pct = d.max > 0 ? Math.round((val / d.max) * 100) : 0;
        return `
        <div class="icp-dim-row">
          <div class="icp-dim-label">${d.label}</div>
          <div class="icp-dim-bar"><div class="icp-dim-fill" style="width:${pct}%;background:${d.color}"></div></div>
          <div class="icp-dim-score" style="color:${d.color}">${val}<span style="font-weight:400;color:var(--muted)">/${d.max}</span></div>
          <div class="icp-dim-reason">${escHtml(String(d.reason))}</div>
        </div>`;
      }).join('')}
    </div>

    <div class="lead-detail-grid">
      <div class="lead-detail-field"><label>Company</label><span>${escHtml(lead.company || lead.companyName || '—')}</span></div>
      <div class="lead-detail-field"><label>Job Title</label><span>${escHtml(lead.jobTitle || '—')}</span></div>
      <div class="lead-detail-field"><label>Country</label><span>${escHtml(lead.country || '—')}</span></div>
      <div class="lead-detail-field"><label>Employees</label><span>${lead.numberOfEmployees || '—'}</span></div>
      <div class="lead-detail-field"><label>Lead Source</label><span style="color:var(--purple)">${escHtml(lead.leadSource || '—')}</span></div>
      <div class="lead-detail-field"><label>Destination Cloud</label><span style="color:var(--green)">${escHtml(lead.destinationCloud || lead.typeOfDestination || '—')}</span></div>
      <div class="lead-detail-field"><label>Source Cloud</label><span style="color:var(--yellow)">${escHtml(lead.sourceCloud || '—')}</span></div>
      <div class="lead-detail-field"><label>Owner</label><span>${escHtml(lead.ownerName || '—')}</span></div>
      <div class="lead-detail-field"><label>Created</label><span>${lead.createDate || lead.createdDate || '—'}</span></div>
      <div class="lead-detail-field"><label>MQL Type</label><span>${escHtml(lead.mqlType || '—')}</span></div>
    </div>
  `;
  overlay.classList.remove('hidden');
}

function closeLeadDetail() {
  document.getElementById('leadDetailOverlay').classList.add('hidden');
}
