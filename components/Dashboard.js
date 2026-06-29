import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { Grid, html as gjHtml } from 'gridjs';

// ─── Config ────────────────────────────────────────────────────────────────
const JIRA_BASE   = 'https://unherd.atlassian.net/browse/';
const PROJECTS    = ['CP'];
const HIDDEN_ENG  = ['unassigned','chris','sherry','fabian','brittany','reinhard'];
const FIELDS      = ['summary','status','assignee','created','updated',
                     'resolutiondate','issuetype','priority','project'];

// ─── Module-level state (vanilla JS — no React re-renders needed) ──────────
let allActive = [], allDone = [];
let activeProjects = new Set(['ALL']);
let activeTypes    = new Set(['ALL']);
let charts = {};
let grids  = {};

// ─── Helpers ───────────────────────────────────────────────────────────────
const daysBetween = (a, b) =>
  a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 86_400_000)) : null;
const daysSince = d => d ? daysBetween(d, new Date().toISOString()) : null;
const avg = arr => arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : null;
const isHidden = name =>
  !name || HIDDEN_ENG.some(h => name.toLowerCase().startsWith(h));

function ageHtml(days) {
  if (days === null) return '<span class="age age-none">—</span>';
  const cls = days <= 2 ? 'age-fresh' : days <= 5 ? 'age-moderate' : 'age-stale';
  return `<span class="age ${cls}">${days}d</span>`;
}
function statusHtml(name, catKey) {
  const cls = catKey === 'indeterminate' ? 'b-inprogress' : catKey === 'done' ? 'b-done' : 'b-todo';
  return `<span class="badge ${cls}">${name}</span>`;
}
function priorityHtml(name) {
  if (!name) return '';
  const map = { critical:'b-critical', high:'b-high', medium:'b-medium',
                low:'b-low', backlog:'b-backlog' };
  return `<span class="badge ${map[name.toLowerCase()]||'b-low'}">${name}</span>`;
}
function keyLink(key) {
  return `<a class="issue-link" href="${JIRA_BASE}${key}" target="_blank" rel="noreferrer">${key}</a>`;
}

// ─── API ────────────────────────────────────────────────────────────────────
async function jiraSearch(jql, maxResults = 100) {
  const params = new URLSearchParams({ jql, maxResults, fields: FIELDS.join(',') });
  const res = await fetch(`/api/jira?${params}`);
  if (!res.ok) throw new Error(`Jira API error ${res.status}`);
  const data = await res.json();
  return data.issues || [];
}

// ─── Filtered view ──────────────────────────────────────────────────────────
function filtered() {
  const byProject = activeProjects.has('ALL')
    ? { active: allActive, done: allDone }
    : {
        active: allActive.filter(i => activeProjects.has(i.fields.project?.key)),
        done:   allDone.filter(i => activeProjects.has(i.fields.project?.key)),
      };
  if (activeTypes.has('ALL')) return byProject;
  return {
    active: byProject.active.filter(i => activeTypes.has(i.fields.issuetype?.name)),
    done:   byProject.done.filter(i => activeTypes.has(i.fields.issuetype?.name)),
  };
}

// ─── KPIs ───────────────────────────────────────────────────────────────────
function renderKPIs(active, done) {
  const inProg = active.filter(i =>
    i.fields.status?.statusCategory?.key === 'indeterminate' &&
    !isHidden(i.fields.assignee?.displayName)
  );
  const stale = inProg.filter(i => (daysSince(i.fields.updated) ?? 0) > 5);
  const cts   = done
    .filter(i => i.fields.created && i.fields.resolutiondate &&
      !isHidden(i.fields.assignee?.displayName))
    .map(i => daysBetween(i.fields.created, i.fields.resolutiondate));

  setText('kpi-active',     active.length);
  setText('kpi-inprogress', inProg.length);
  setText('kpi-cycle',      avg(cts) !== null ? avg(cts) + 'd' : '—');
  setText('kpi-stale',      stale.length);
}

// ─── Charts ─────────────────────────────────────────────────────────────────
function makeChart(id, type, labels, values, colors, opts = {}) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type,
    data: { labels, datasets: [{ data: values, backgroundColor: colors,
      borderRadius: type === 'bar' ? 4 : 0,
      borderSkipped: type === 'bar' ? false : undefined,
      borderWidth: type === 'doughnut' ? 2 : undefined,
      borderColor: type === 'doughnut' ? '#fff' : undefined,
      hoverOffset: type === 'doughnut' ? 4 : undefined,
      ...opts.datasetExtra }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: opts.legend ?? { display: false },
        tooltip: { callbacks: { label: ctx =>
          ` ${opts.tooltipSuffix ? ctx.parsed[opts.axis === 'y' ? 'x' : 'y'] : ctx.parsed.y} ${opts.tooltipSuffix || 'issues'}` } },
      },
      scales: type === 'doughnut' ? undefined : {
        [opts.axis === 'y' ? 'x' : 'y']: {
          beginAtZero: true, ticks: { precision: 0, font: { size: 10 } },
          grid: { color: '#f0f0f0' }
        },
        [opts.axis === 'y' ? 'y' : 'x']: {
          ticks: { font: { size: opts.axis === 'y' ? 11 : 10 }, maxRotation: 40 },
          grid: { display: false }
        },
      },
      cutout: type === 'doughnut' ? '62%' : undefined,
      indexAxis: opts.axis,
    },
  });
}

function renderStatusChart(active) {
  const counts = {};
  active.forEach(i => { const s = i.fields.status?.name||'?'; counts[s]=(counts[s]||0)+1; });
  const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  makeChart('status-chart', 'bar',
    entries.map(([k])=>k), entries.map(([,v])=>v),
    entries.map((_,i)=>`hsl(${(i*53+220)%360},65%,62%)`));
}

function renderEngineerChart(active) {
  const counts = {};
  active.forEach(i => {
    const n = i.fields.assignee?.displayName || 'Unassigned';
    if (isHidden(n)) return;
    counts[n] = (counts[n]||0)+1;
  });
  const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,12);
  makeChart('engineer-chart', 'bar',
    entries.map(([n])=>n.split(' ')[0]),
    entries.map(([,v])=>v),
    entries.map((_,i)=>`hsl(${(i*61+180)%360},60%,60%)`),
    { axis: 'y' });
}

function renderThroughputChart(done) {
  const now = Date.now();
  const labels = [], values = [];
  for (let w = 4; w >= 0; w--) {
    const s = now - (w+1)*7*86400000, e = now - w*7*86400000;
    labels.push(new Date(e).toLocaleDateString('en-GB',{day:'2-digit',month:'short'}));
    values.push(done.filter(i => {
      if (!i.fields.resolutiondate) return false;
      const t = new Date(i.fields.resolutiondate).getTime();
      return t >= s && t < e;
    }).length);
  }
  const ctx = document.getElementById('throughput-chart');
  if (!ctx) return;
  if (charts['throughput-chart']) charts['throughput-chart'].destroy();
  charts['throughput-chart'] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{
      data: values, borderColor:'#4361ee',
      backgroundColor:'rgba(67,97,238,0.12)',
      borderWidth:2.5, pointRadius:5,
      pointBackgroundColor:'#4361ee',
      fill:true, tension:0.3
    }]},
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false},
        tooltip:{ callbacks:{ label: ctx => ` ${ctx.parsed.y} completed` } } },
      scales:{
        y:{ beginAtZero:true, ticks:{precision:0,font:{size:10}}, grid:{color:'#f0f0f0'} },
        x:{ ticks:{font:{size:10}}, grid:{display:false} }
      }
    }
  });
}

function renderCycleTimeChart(done) {
  const b = { '1-3d':0,'4-7d':0,'8-14d':0,'15-30d':0,'>30d':0 };
  done.forEach(i => {
    const ct = daysBetween(i.fields.created, i.fields.resolutiondate);
    if (ct === null) return;
    if (ct <= 3) b['1-3d']++;
    else if (ct <= 7) b['4-7d']++;
    else if (ct <= 14) b['8-14d']++;
    else if (ct <= 30) b['15-30d']++;
    else b['>30d']++;
  });
  makeChart('cycletime-chart','bar',
    Object.keys(b), Object.values(b),
    ['#2dc653','#4cc9f0','#4361ee','#f4a261','#e63946']);
}

function renderPriorityChart(active) {
  const ORDER = ['Critical','High','Medium','Low','Backlog'];
  const counts = {};
  active.forEach(i => { const p=i.fields.priority?.name||'?'; counts[p]=(counts[p]||0)+1; });
  const labels = ORDER.filter(k=>counts[k]);
  const colors = { Critical:'#e63946',High:'#f4a261',Medium:'#4361ee',
                   Low:'#2dc653',Backlog:'#adb5bd' };
  makeChart('priority-chart','doughnut',labels,labels.map(l=>counts[l]),
    labels.map(l=>colors[l]||'#ccc'),
    { legend:{ position:'right', labels:{font:{size:11},padding:10,boxWidth:12} } });
}

function renderTypeChart(active) {
  const counts = {};
  active.forEach(i => { const t=i.fields.issuetype?.name||'?'; counts[t]=(counts[t]||0)+1; });
  const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  const palette = ['#4361ee','#4cc9f0','#f4a261','#2dc653','#e63946','#7b2d8b','#adb5bd'];
  makeChart('type-chart','doughnut',
    entries.map(([k])=>k), entries.map(([,v])=>v),
    entries.map((_,i)=>palette[i%palette.length]),
    { legend:{ position:'right', labels:{font:{size:11},padding:10,boxWidth:12} } });
}

// ─── Tables ─────────────────────────────────────────────────────────────────
function renderInProgress(active) {
  const rows = active
    .filter(i => i.fields.status?.statusCategory?.key === 'indeterminate'
      && !isHidden(i.fields.assignee?.displayName))
    .sort((a,b) => new Date(a.fields.updated)-new Date(b.fields.updated))
    .map(i => [
      i.key,
      trunc(i.fields.summary, 75),
      statusHtml(i.fields.status?.name, i.fields.status?.statusCategory?.key),
      i.fields.assignee?.displayName||'Unassigned',
      priorityHtml(i.fields.priority?.name),
      ageHtml(daysSince(i.fields.updated)),
      ageHtml(daysSince(i.fields.created)),
    ]);

  renderGrid('inprogress-table', [
    { name:'Key',       formatter: c => gjHtml(keyLink(c)), width:'90px' },
    { name:'Summary',   width:'38%' },
    { name:'Status',    formatter: c => gjHtml(c), sort:false, width:'120px' },
    { name:'Assignee',  width:'140px' },
    { name:'Priority',  formatter: c => gjHtml(c), sort:false, width:'100px' },
    { name:'Stale',     formatter: c => gjHtml(c), width:'70px' },
    { name:'Age',       formatter: c => gjHtml(c), width:'70px' },
  ], rows, { search:true, pagination:{ limit:8 } });
}

function renderEngineerTable(active, done) {
  const eng = {};
  active.forEach(i => {
    const n = i.fields.assignee?.displayName||'Unassigned';
    if (isHidden(n)) return;
    if (!eng[n]) eng[n]={ active:0, inprog:0, ages:[], stalest:0 };
    eng[n].active++;
    const upd = daysSince(i.fields.updated)??0;
    eng[n].ages.push(daysSince(i.fields.created)??0);
    if (upd > eng[n].stalest) eng[n].stalest = upd;
    if (i.fields.status?.statusCategory?.key==='indeterminate') eng[n].inprog++;
  });
  const dBuckets = {};
  done.forEach(i => {
    const n = i.fields.assignee?.displayName||'Unassigned';
    if (isHidden(n)) return;
    const ct = daysBetween(i.fields.created, i.fields.resolutiondate);
    if (!dBuckets[n]) dBuckets[n]={ count:0, cts:[] };
    dBuckets[n].count++;
    if (ct!==null) dBuckets[n].cts.push(ct);
  });

  const rows = Object.entries(eng).sort((a,b)=>b[1].inprog-a[1].inprog).map(([n,s])=>{
    const db=dBuckets[n], avgCT=db?avg(db.cts):null;
    return [
      n, s.active, s.inprog,
      ageHtml(avg(s.ages)), ageHtml(s.stalest),
      db?.count??0,
      avgCT!==null ? ageHtml(avgCT) : '<span class="age age-none">—</span>',
    ];
  });

  renderGrid('tab-engineer', [
    { name:'Engineer', formatter: c => gjHtml(
      `<span style="color:#4361ee;cursor:pointer;font-weight:600"
        onclick="window.__dash.openDrilldown('${c.replace(/'/g,"\\'")}')">↗ ${c}</span>`) },
    { name:'Active',          width:'80px' },
    { name:'In Progress',     width:'95px' },
    { name:'Avg Age',         formatter: c=>gjHtml(c) },
    { name:'Stalest',         formatter: c=>gjHtml(c) },
    { name:'Done (30d)',      width:'90px' },
    { name:'Avg Cycle Time',  formatter: c=>gjHtml(c), width:'110px' },
  ], rows, { sort:true });
}

function openDrilldown(name) {
  const { active } = filtered();
  const issues = active
    .filter(i => (i.fields.assignee?.displayName||'Unassigned')===name)
    .sort((a,b) => new Date(a.fields.updated)-new Date(b.fields.updated));

  const titleEl = document.getElementById('drilldown-title');
  const panel   = document.getElementById('engineer-drilldown');
  if (!titleEl || !panel) return;
  titleEl.textContent = `${name} — oldest active tickets`;
  panel.style.display = '';

  renderGrid('drilldown-table', [
    { name:'Key',      formatter: c=>gjHtml(keyLink(c)) },
    { name:'Summary',  width:'40%' },
    { name:'Status',   formatter: c=>gjHtml(c), sort:false },
    { name:'Priority', formatter: c=>gjHtml(c), sort:false },
    { name:'Since Update', formatter: c=>gjHtml(c) },
    { name:'Age',      formatter: c=>gjHtml(c) },
  ], issues.map(i=>[
    i.key, trunc(i.fields.summary,65),
    statusHtml(i.fields.status?.name, i.fields.status?.statusCategory?.key),
    priorityHtml(i.fields.priority?.name),
    ageHtml(daysSince(i.fields.updated)),
    ageHtml(daysSince(i.fields.created)),
  ]), { sort:true, pagination:{ limit:10 } });

  panel.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function closeDrilldown() {
  const panel = document.getElementById('engineer-drilldown');
  if (panel) panel.style.display = 'none';
  if (grids.drilldown) { grids.drilldown.destroy(); delete grids.drilldown; }
}

function renderDoneTable(done) {
  const rows = [...done]
    .filter(i => !isHidden(i.fields.assignee?.displayName))
    .sort((a,b)=>new Date(b.fields.resolutiondate)-new Date(a.fields.resolutiondate))
    .map(i=>{
      const ct = daysBetween(i.fields.created, i.fields.resolutiondate);
      return [
        i.key, trunc(i.fields.summary,65),
        i.fields.assignee?.displayName||'Unassigned',
        i.fields.project?.key||'',
        i.fields.resolutiondate
          ? new Date(i.fields.resolutiondate).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})
          : '—',
        ct!==null ? ageHtml(ct) : '<span class="age age-none">—</span>',
        priorityHtml(i.fields.priority?.name),
      ];
    });

  if (!rows.length) {
    setHtml('tab-done','<p class="empty">No completed issues in the last 30 days.</p>');
    return;
  }
  renderGrid('tab-done', [
    { name:'Key',        formatter: c=>gjHtml(keyLink(c)) },
    { name:'Summary',    width:'35%' },
    { name:'Assignee' },
    { name:'Project',    width:'80px' },
    { name:'Completed',  width:'95px' },
    { name:'Cycle Time', formatter: c=>gjHtml(c) },
    { name:'Priority',   formatter: c=>gjHtml(c), sort:false },
  ], rows, { search:true, pagination:{ limit:15 } });
}

function renderStatusBreakdown(active) {
  const map = {};
  active.forEach(i => {
    const s=i.fields.status?.name||'?', cat=i.fields.status?.statusCategory?.key||'new';
    if (!map[s]) map[s]={ cat, issues:[] };
    map[s].issues.push(daysSince(i.fields.updated)??0);
  });
  const rows = Object.entries(map)
    .sort((a,b)=>b[1].issues.length-a[1].issues.length)
    .map(([name,{cat,issues}])=>[
      statusHtml(name,cat), issues.length,
      ageHtml(avg(issues)), ageHtml(Math.max(...issues)), ageHtml(Math.min(...issues)),
    ]);
  if (!rows.length) { setHtml('tab-status','<p class="empty">No data.</p>'); return; }
  renderGrid('tab-status', [
    { name:'Status',    formatter: c=>gjHtml(c), sort:false },
    { name:'Issues',    width:'80px' },
    { name:'Avg Since Update', formatter: c=>gjHtml(c) },
    { name:'Max',       formatter: c=>gjHtml(c) },
    { name:'Min',       formatter: c=>gjHtml(c) },
  ], rows, { sort:true });
}

// ─── Grid helper ────────────────────────────────────────────────────────────
function renderGrid(elId, columns, data, opts = {}) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = '';
  if (grids[elId]) { grids[elId].destroy(); delete grids[elId]; }
  grids[elId] = new Grid({ columns, data, sort:true, ...opts }).render(el);
}

// ─── Tabs ────────────────────────────────────────────────────────────────────
function showTab(id, btn) {
  ['tab-engineer','tab-done','tab-status'].forEach(t => {
    const el = document.getElementById(t);
    if (el) el.style.display = t===id ? '' : 'none';
  });
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

// ─── Project filter ──────────────────────────────────────────────────────────
function setupFilters() {
  const seen = new Set([
    ...allActive.map(i=>i.fields.project?.key),
    ...allDone.map(i=>i.fields.project?.key),
  ].filter(Boolean));

  const container = document.getElementById('project-filters');
  if (!container) return;
  container.innerHTML = '<div class="filter-pill active" data-project="ALL">All Projects</div>';
  [...seen].sort().forEach(key => {
    const pill = document.createElement('div');
    pill.className = 'filter-pill';
    pill.dataset.project = key;
    pill.textContent = key;
    container.appendChild(pill);
  });
  container.addEventListener('click', e => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    const p = pill.dataset.project;
    if (p === 'ALL') {
      activeProjects = new Set(['ALL']);
      container.querySelectorAll('.filter-pill').forEach(el=>el.classList.remove('active'));
      pill.classList.add('active');
    } else {
      activeProjects.delete('ALL');
      container.querySelector('[data-project="ALL"]').classList.remove('active');
      pill.classList.toggle('active');
      if (pill.classList.contains('active')) activeProjects.add(p);
      else activeProjects.delete(p);
      if (!activeProjects.size) {
        activeProjects.add('ALL');
        container.querySelector('[data-project="ALL"]').classList.add('active');
      }
    }
    renderAll();
  });
}

// ─── Type filter ─────────────────────────────────────────────────────────────
function setupTypeFilters() {
  const seen = new Set([
    ...allActive.map(i => i.fields.issuetype?.name),
    ...allDone.map(i => i.fields.issuetype?.name),
  ].filter(Boolean));

  const container = document.getElementById('type-filters');
  if (!container) return;
  container.innerHTML = '<div class="filter-pill type-pill active" data-type="ALL">All Types</div>';
  [...seen].sort().forEach(name => {
    const pill = document.createElement('div');
    pill.className = 'filter-pill type-pill';
    pill.dataset.type = name;
    pill.textContent = name;
    container.appendChild(pill);
  });
  container.addEventListener('click', e => {
    const pill = e.target.closest('.type-pill');
    if (!pill) return;
    const t = pill.dataset.type;
    if (t === 'ALL') {
      activeTypes = new Set(['ALL']);
      container.querySelectorAll('.type-pill').forEach(el => el.classList.remove('active'));
      pill.classList.add('active');
    } else {
      activeTypes.delete('ALL');
      container.querySelector('[data-type="ALL"]').classList.remove('active');
      pill.classList.toggle('active');
      if (pill.classList.contains('active')) activeTypes.add(t);
      else activeTypes.delete(t);
      if (!activeTypes.size) {
        activeTypes.add('ALL');
        container.querySelector('[data-type="ALL"]').classList.add('active');
      }
    }
    renderAll();
  });
}

// ─── Render all ──────────────────────────────────────────────────────────────
function renderAll() {
  const { active, done } = filtered();
  renderKPIs(active, done);
  renderStatusChart(active);
  renderEngineerChart(active);
  renderThroughputChart(done);
  renderCycleTimeChart(done);
  renderPriorityChart(active);
  renderTypeChart(active);
  renderInProgress(active);
  renderEngineerTable(active, done);
  renderDoneTable(done);
  renderStatusBreakdown(active);
}

// ─── Load ────────────────────────────────────────────────────────────────────
async function load() {
  const proj = PROJECTS.join(', ');
  try {
    const [active, done] = await Promise.all([
      jiraSearch(
        `project in (${proj}) AND statusCategory != Done AND status != "To Scope" AND issuetype not in (Epic, Subtask) ORDER BY updated ASC`,
        100
      ),
      jiraSearch(
        `project in (${proj}) AND statusCategory = Done AND resolutiondate >= -30d AND issuetype not in (Epic, Subtask) ORDER BY resolutiondate DESC`,
        100
      ),
    ]);
    allActive = active;
    allDone   = done;
    setText('meta-updated',
      `Refreshed ${new Date().toLocaleTimeString('en-GB')} · ${active.length} active, ${done.length} done (30d)`);
    setupFilters();
    setupTypeFilters();
    renderAll();
  } catch (err) {
    console.error(err);
    const errBox = document.createElement('div');
    errBox.className = 'error-box';
    errBox.textContent = `⚠️ ${err.message}`;
    document.getElementById('kpi-row')?.insertAdjacentElement('afterend', errBox);
    setText('meta-updated', 'Load failed');
  }
}

// ─── DOM utils ────────────────────────────────────────────────────────────────
function setText(id, val) { const el=document.getElementById(id); if(el) el.textContent=val; }
function setHtml(id, val) { const el=document.getElementById(id); if(el) el.innerHTML=val; }
function trunc(s, n) { return s && s.length>n ? s.slice(0,n)+'…' : (s||''); }

// ─── React component ──────────────────────────────────────────────────────────
export default function Dashboard() {
  const initialised = useRef(false);

  useEffect(() => {
    if (initialised.current) return;
    initialised.current = true;

    // Expose functions called from Grid.js HTML strings
    window.__dash = { openDrilldown, closeDrilldown, showTab };

    load();
  }, []);

  return (
    <div>
      {/* Header */}
      <div className="header">
        <div className="header-left">
          <h1>Engineering Delivery Dashboard</h1>
          <p>unherd.atlassian.net — CoEditor Platform (CP)</p>
        </div>
        <div className="header-meta" id="meta-updated">Loading data…</div>
      </div>

      {/* Type filter pills (populated by JS) */}
      <div className="filters type-filters" id="type-filters">
        <div className="filter-pill type-pill active" data-type="ALL">All Types</div>
      </div>

      {/* KPI cards */}
      <div className="kpi-row" id="kpi-row">
        <div className="kpi-card blue">
          <div className="kpi-label">Active Issues</div>
          <div className="kpi-value" id="kpi-active">—</div>
          <div className="kpi-sub">not done (excl. epics)</div>
        </div>
        <div className="kpi-card orange">
          <div className="kpi-label">In Progress</div>
          <div className="kpi-value" id="kpi-inprogress">—</div>
          <div className="kpi-sub">currently being worked on</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-label">Avg Cycle Time</div>
          <div className="kpi-value" id="kpi-cycle">—</div>
          <div className="kpi-sub">days, completed last 30d</div>
        </div>
        <div className="kpi-card red">
          <div className="kpi-label">Stale (&gt;5 days)</div>
          <div className="kpi-value" id="kpi-stale">—</div>
          <div className="kpi-sub">in progress, no activity</div>
        </div>
      </div>

      {/* Two-column table row — stacks on mobile */}
      <div className="tables-row">

        {/* Tabbed section — By Engineer / Completed / Time in Status */}
        <div className="table-card">
          <div className="tabs">
            <div className="tab active"
              onClick={e => window.__dash?.showTab('tab-engineer', e.currentTarget)}>
              By Engineer
            </div>
            <div className="tab"
              onClick={e => window.__dash?.showTab('tab-done', e.currentTarget)}>
              Completed (Last 30d)
            </div>
            <div className="tab"
              onClick={e => window.__dash?.showTab('tab-status', e.currentTarget)}>
              Time in Status
            </div>
          </div>

          <div className="table-scroll-wrap">
            <div id="tab-engineer">
              <div className="spinner-wrap"><div className="spinner" /><p>Loading…</p></div>
            </div>
            <div id="tab-done" style={{ display:'none' }}>
              <div className="spinner-wrap"><div className="spinner" /><p>Loading…</p></div>
            </div>
            <div id="tab-status" style={{ display:'none' }}>
              <div className="spinner-wrap"><div className="spinner" /><p>Loading…</p></div>
            </div>
          </div>

          {/* Engineer drilldown panel */}
          <div id="engineer-drilldown" style={{ display:'none', marginTop:'14px',
            borderTop:'2px solid #f0f0f0', paddingTop:'14px' }}>
            <div style={{ display:'flex', alignItems:'center',
              justifyContent:'space-between', marginBottom:'10px' }}>
              <h3 id="drilldown-title" style={{ color:'#4361ee' }}></h3>
              <button
                onClick={() => window.__dash?.closeDrilldown()}
                style={{ background:'none', border:'none', cursor:'pointer',
                  fontSize:'20px', color:'#aaa', lineHeight:'1' }}
                aria-label="Close">
                ×
              </button>
            </div>
            <div id="drilldown-table" />
          </div>
        </div>

        {/* In-progress table */}
        <div className="table-card">
          <h3>In Progress — Sorted by Days Since Last Activity ↑</h3>
          <div className="table-scroll-wrap">
            <div id="inprogress-table">
              <div className="spinner-wrap"><div className="spinner" /><p>Loading…</p></div>
            </div>
          </div>
          <p className="note">
            ℹ︎ "Since Last Activity" uses the Jira updated timestamp as a proxy for time in current status.
          </p>
        </div>

      </div>{/* end .tables-row */}

      {/* Charts row 1 */}
      <div className="charts-row">
        <div className="card">
          <h3>Issues by Status</h3>
          <div className="chart-wrap"><canvas id="status-chart" /></div>
        </div>
        <div className="card">
          <h3>Active Issues by Engineer</h3>
          <div className="chart-wrap"><canvas id="engineer-chart" /></div>
        </div>
      </div>

      {/* Charts row 2 */}
      <div className="charts-row">
        <div className="card">
          <h3>Weekly Throughput (Last 5 Weeks)</h3>
          <div className="chart-wrap"><canvas id="throughput-chart" /></div>
        </div>
        <div className="card">
          <h3>Cycle Time Distribution (Last 30d)</h3>
          <div className="chart-wrap"><canvas id="cycletime-chart" /></div>
        </div>
      </div>

      {/* Charts row 3 */}
      <div className="charts-row">
        <div className="card">
          <h3>Active Issues by Priority</h3>
          <div className="chart-wrap"><canvas id="priority-chart" /></div>
        </div>
        <div className="card">
          <h3>Active Issues by Type</h3>
          <div className="chart-wrap"><canvas id="type-chart" /></div>
        </div>
      </div>
    </div>
  );
}
