import { useState, useMemo, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer,
  PieChart, Pie, Legend,
} from 'recharts'
import { useJiraIssues } from '../hooks/useJiraIssues'

// ─── palette ──────────────────────────────────────────────────────────────────
const GREEN  = '#16a34a'
const GREEN2 = '#dcfce7'
const AMBER  = '#d97706'
const BLUE   = '#2563eb'
const BORDER = '#e5e7eb'
const TEXT   = '#111827'
const MUTED  = '#6b7280'
const BG     = '#f9fafb'
const WHITE  = '#ffffff'

const STATUS_COLOR = {
  'To Do':       { bg: '#f1f5f9', text: '#475569' },
  'In Progress': { bg: '#dbeafe', text: '#1d4ed8' },
  'In Review':   { bg: '#fef3c7', text: '#b45309' },
  'Code Review': { bg: '#fef3c7', text: '#b45309' },
  'Done':        { bg: '#dcfce7', text: '#15803d' },
  'Blocked':     { bg: '#fee2e2', text: '#b91c1c' },
}

const PRIORITY_COLOR = {
  Highest: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#3b82f6', Lowest: '#94a3b8',
}

const BASE = 'project in (CP, CXO) AND labels = "OQS-Request"'

const PRESETS = [
  { label: 'All',           jql: `${BASE} ORDER BY updated DESC` },
  { label: 'Open',          jql: `${BASE} AND statusCategory != Done ORDER BY updated DESC` },
  { label: 'In Progress',   jql: `${BASE} AND status = "In Progress" ORDER BY updated DESC` },
  { label: 'Done',          jql: `${BASE} AND statusCategory = Done ORDER BY updated DESC` },
  { label: 'High priority', jql: `${BASE} AND priority in (Highest, High) AND statusCategory != Done ORDER BY priority ASC` },
]

const TYPE_FILTERS = [
  { label: 'All types', value: '' },
  { label: 'Support',   value: 'Support Request' },
  { label: 'Bug',       value: 'Bug' },
]

const SORT_OPTIONS = [
  { label: 'Newest first', field: 'updated',  dir: 'desc' },
  { label: 'Oldest first', field: 'updated',  dir: 'asc' },
  { label: 'Priority',     field: 'priority', dir: 'asc' },
  { label: 'Status',       field: 'status',   dir: 'asc' },
]

const PRIORITY_ORDER = { Highest: 0, High: 1, Medium: 2, Low: 3, Lowest: 4 }
const STATUS_ORDER   = { Blocked: 0, 'In Progress': 1, 'In Review': 2, 'Code Review': 2, 'To Do': 3, Done: 4 }

// ─── helpers ──────────────────────────────────────────────────────────────────
function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024)
  useEffect(() => {
    const fn = () => setWidth(window.innerWidth)
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return width
}

function adfToText(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  if (node.content) return node.content.map(adfToText).join(' ')
  return ''
}

function fmt(str) {
  if (!str) return '—'
  return new Date(str).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function timeInStatus(dateStr) {
  if (!dateStr) return null
  const d = daysSince(dateStr)
  if (d === 0) return 'Today'
  if (d === 1) return '1 day'
  if (d < 7)  return `${d} days`
  if (d < 30) return `${Math.floor(d / 7)}w ${d % 7}d`
  const m = Math.floor(d / 30)
  return `${m} month${m > 1 ? 's' : ''}`
}

function sortIssues(issues, { field, dir }) {
  const m = dir === 'asc' ? 1 : -1
  return [...issues].sort((a, b) => {
    if (field === 'updated')  return m * a.fields.updated.localeCompare(b.fields.updated)
    if (field === 'priority') return m * ((PRIORITY_ORDER[a.fields.priority?.name] ?? 9) - (PRIORITY_ORDER[b.fields.priority?.name] ?? 9))
    if (field === 'status')   return m * ((STATUS_ORDER[a.fields.status?.name] ?? 9) - (STATUS_ORDER[b.fields.status?.name] ?? 9))
    return 0
  })
}

// ─── small components ─────────────────────────────────────────────────────────
function Badge({ name }) {
  const { bg, text } = STATUS_COLOR[name] ?? { bg: '#f1f5f9', text: '#475569' }
  return (
    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 500, background: bg, color: text, whiteSpace: 'nowrap' }}>
      {name}
    </span>
  )
}

function Stat({ label, value, color = TEXT }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 20px' }}>
      <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: MUTED, marginTop: 5 }}>{label}</div>
    </div>
  )
}

function Progress({ issues }) {
  const total = issues.length
  const done  = issues.filter(({ fields }) => fields.status?.statusCategory?.key === 'done').length
  const pct   = total ? Math.round((done / total) * 100) : 0
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Overall progress</span>
        <span style={{ fontSize: 20, fontWeight: 700, color: GREEN }}>{pct}%</span>
      </div>
      <div style={{ background: '#f1f5f9', borderRadius: 99, height: 6 }}>
        <div style={{ width: `${pct}%`, background: GREEN, height: 6, borderRadius: 99, transition: 'width .4s' }} />
      </div>
      <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>{done} of {total} completed</div>
    </div>
  )
}

const TIP = {
  contentStyle: { borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,.08)' },
  cursor: { fill: BG },
}

function ChartCard({ title, children }) {
  return (
    <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 16px 8px' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  )
}

// ─── charts ───────────────────────────────────────────────────────────────────
function StatusChart({ issues }) {
  const data = useMemo(() => {
    const c = {}
    issues.forEach(({ fields }) => { const n = fields.status?.name ?? 'Unknown'; c[n] = (c[n] ?? 0) + 1 })
    return Object.entries(c).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  }, [issues])
  const COLORS = ['#16a34a','#4ade80','#86efac','#bbf7d0','#6b7280']
  if (!data.length) return null
  return (
    <ChartCard title="Status breakdown">
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} margin={{ top: 0, right: 0, left: -28, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} />
          <Tooltip {...TIP} />
          <Bar dataKey="count" radius={[4,4,0,0]} maxBarSize={32}>
            {data.map((e, i) => <Cell key={e.name} fill={COLORS[i % COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function PriorityChart({ issues }) {
  const data = useMemo(() => {
    const c = {}
    issues.forEach(({ fields }) => { const n = fields.priority?.name ?? 'Unknown'; c[n] = (c[n] ?? 0) + 1 })
    return Object.entries(c)
      .map(([name, value]) => ({ name, value, fill: PRIORITY_COLOR[name] ?? '#94a3b8' }))
      .sort((a, b) => (PRIORITY_ORDER[a.name] ?? 9) - (PRIORITY_ORDER[b.name] ?? 9))
  }, [issues])
  if (!data.length) return null
  return (
    <ChartCard title="Priority mix">
      <ResponsiveContainer width="100%" height={140}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="40%" cy="50%" innerRadius={32} outerRadius={55} paddingAngle={2}>
            {data.map(e => <Cell key={e.name} fill={e.fill} />)}
          </Pie>
          <Tooltip {...TIP} formatter={(v, n) => [v, n]} />
          <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 10, paddingLeft: 4 }} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function TypeChart({ issues }) {
  const data = useMemo(() => {
    const c = {}
    issues.forEach(({ fields }) => { const n = fields.issuetype?.name ?? 'Other'; c[n] = (c[n] ?? 0) + 1 })
    return Object.entries(c).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }, [issues])
  const COLORS = ['#16a34a','#2563eb','#d97706','#8b5cf6','#ef4444','#6b7280']
  if (!data.length) return null
  return (
    <ChartCard title="Tickets by type">
      <ResponsiveContainer width="100%" height={140}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="40%" cy="50%" innerRadius={32} outerRadius={55} paddingAngle={2}>
            {data.map((e, i) => <Cell key={e.name} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip {...TIP} formatter={(v, n) => [v, n]} />
          <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 10, paddingLeft: 4 }} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

function AgeChart({ issues }) {
  const data = useMemo(() => {
    const open = issues.filter(({ fields }) => fields.status?.statusCategory?.key !== 'done')
    const b = { 'This week': 0, '1–4 wks': 0, '1–3 mo': 0, '3 mo+': 0 }
    open.forEach(({ fields }) => {
      const d = daysSince(fields.created)
      if (d < 7) b['This week']++
      else if (d < 28) b['1–4 wks']++
      else if (d < 90) b['1–3 mo']++
      else b['3 mo+']++
    })
    return Object.entries(b).map(([name, count]) => ({ name, count }))
  }, [issues])
  const COLORS = ['#4ade80','#16a34a','#d97706','#ef4444']
  if (!data.some(d => d.count > 0)) return null
  return (
    <ChartCard title="Age of open tickets">
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} margin={{ top: 0, right: 0, left: -28, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} />
          <Tooltip {...TIP} />
          <Bar dataKey="count" radius={[4,4,0,0]} maxBarSize={32}>
            {data.map((e, i) => <Cell key={e.name} fill={COLORS[i]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

// ─── accordion detail ─────────────────────────────────────────────────────────
function IssueDetail({ fields }) {
  const desc     = fields.description ? adfToText(fields.description).trim() : ''
  const inStatus = timeInStatus(fields.statuscategorychangedate ?? fields.updated)
  const meta = [
    ['Reporter',       fields.reporter?.displayName ?? '—'],
    ['Type',           fields.issuetype?.name ?? '—'],
    ['Project',        fields.project?.name ?? '—'],
    ['Created',        fmt(fields.created)],
    ['Updated',        fmt(fields.updated)],
    ...(inStatus ? [['Time in status', inStatus + (fields.statuscategorychangedate ? '' : ' (approx)')]] : []),
  ]
  return (
    <div style={{ padding: '16px 16px 20px', borderTop: `1px solid ${GREEN2}` }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Description</div>
      <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.65, marginBottom: 16, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
        {desc || <span style={{ color: MUTED, fontStyle: 'italic' }}>No description.</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '10px 16px' }}>
        {meta.map(([label, val]) => (
          <div key={label}>
            <div style={{ fontSize: 10, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 13, color: TEXT }}>{val}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── table row (desktop) ──────────────────────────────────────────────────────
function IssueRow({ issue, expanded, onToggle }) {
  const { key, fields } = issue
  const labels = (fields.labels ?? []).filter(l => l !== 'OQS-Request')
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer', borderBottom: `1px solid ${expanded ? 'transparent' : BORDER}`, background: expanded ? '#f0fdf4' : WHITE }}>
        <td style={td}>
          <a href={`https://unherd.atlassian.net/browse/${key}`} target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: MUTED, textDecoration: 'none', borderBottom: `1px dashed ${BORDER}` }}>
            {key}
          </a>
        </td>
        <td style={{ ...td, maxWidth: 400 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14, color: TEXT }}>{fields.summary}</div>
          {labels.length > 0 && (
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              {labels.map(l => <span key={l} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, background: '#f1f5f9', color: MUTED }}>{l}</span>)}
            </div>
          )}
        </td>
        <td style={td}><Badge name={fields.status?.name ?? '—'} /></td>
        <td style={td}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEXT }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: PRIORITY_COLOR[fields.priority?.name] ?? '#94a3b8', flexShrink: 0 }} />
            {fields.priority?.name ?? '—'}
          </span>
        </td>
        <td style={{ ...td, fontSize: 12, color: MUTED, whiteSpace: 'nowrap' }}>{fmt(fields.updated)}</td>
        <td style={{ ...td, width: 28, color: MUTED, fontSize: 10, textAlign: 'center' }}>{expanded ? '▲' : '▼'}</td>
      </tr>
      {expanded && (
        <tr style={{ background: '#f0fdf4', borderBottom: `1px solid ${BORDER}` }}>
          <td colSpan={6} style={{ padding: 0 }}>
            <IssueDetail fields={fields} />
          </td>
        </tr>
      )}
    </>
  )
}

// ─── card (mobile) ────────────────────────────────────────────────────────────
function IssueCard({ issue, expanded, onToggle }) {
  const { key, fields } = issue
  const labels = (fields.labels ?? []).filter(l => l !== 'OQS-Request')
  return (
    <div style={{ background: WHITE, border: `1px solid ${expanded ? GREEN2 : BORDER}`, borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ padding: '14px 14px 12px', cursor: 'pointer' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
          <a href={`https://unherd.atlassian.net/browse/${key}`} target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: MUTED, textDecoration: 'none', borderBottom: `1px dashed ${BORDER}`, flexShrink: 0 }}>
            {key}
          </a>
          <span style={{ fontSize: 10, color: MUTED }}>{expanded ? '▲' : '▼'}</span>
        </div>
        <div style={{ fontSize: 14, color: TEXT, fontWeight: 500, marginBottom: 10, lineHeight: 1.4, wordBreak: 'break-word' }}>{fields.summary}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge name={fields.status?.name ?? '—'} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: MUTED }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: PRIORITY_COLOR[fields.priority?.name] ?? '#94a3b8' }} />
            {fields.priority?.name ?? '—'}
          </span>
          {labels.map(l => <span key={l} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, background: '#f1f5f9', color: MUTED }}>{l}</span>)}
        </div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 8 }}>{fmt(fields.updated)}</div>
      </div>
      {expanded && <IssueDetail fields={fields} />}
    </div>
  )
}

const td = { padding: '12px 16px', verticalAlign: 'middle' }

// ─── main ────────────────────────────────────────────────────────────────────
export default function IssueDashboard() {
  const width = useWindowWidth()
  const isMobile = width < 768

  const [preset,     setPreset]     = useState(0)
  const [jql,        setJql]        = useState(PRESETS[0].jql)
  const [customJql,  setCustomJql]  = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [sortIdx,    setSortIdx]    = useState(0)
  const [expanded,   setExpanded]   = useState({})

  const { issues: raw, total, loading, error, refetch } = useJiraIssues(jql, 500)
  const issues = useMemo(() => raw, [raw])

  const displayed = useMemo(() => {
    const filtered = typeFilter ? issues.filter(({ fields }) => fields.issuetype?.name === typeFilter) : issues
    return sortIssues(filtered, SORT_OPTIONS[sortIdx])
  }, [issues, typeFilter, sortIdx])

  const stats = useMemo(() => {
    const done = issues.filter(({ fields }) => fields.status?.statusCategory?.key === 'done').length
    return {
      total:      issues.length,
      open:       issues.filter(({ fields }) => fields.status?.statusCategory?.key !== 'done').length,
      inProgress: issues.filter(({ fields }) => fields.status?.name === 'In Progress').length,
      done,
    }
  }, [issues])

  const toggle = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }))
  const handlePreset = (i) => { setPreset(i); setJql(PRESETS[i].jql); setCustomJql(''); setExpanded({}) }
  const handleSearch = (e) => { e.preventDefault(); if (customJql.trim()) { setPreset(-1); setJql(customJql.trim()); setExpanded({}) } }

  const p = isMobile ? '16px 12px' : '36px 32px'

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: BG, minHeight: '100vh', padding: p, maxWidth: 1160, margin: '0 auto', boxSizing: 'border-box', overflowX: 'hidden', width: '100%' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', marginBottom: 24, gap: 12 }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, color: TEXT, margin: 0 }}>OQS Requests</h1>
          <p style={{ fontSize: 12, color: MUTED, margin: '3px 0 0' }}>
            <code style={{ background: GREEN2, color: GREEN, padding: '1px 5px', borderRadius: 4, fontSize: 11 }}>OQS-Request</code> tickets
          </p>
        </div>
        <button onClick={refetch} disabled={loading}
          style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${BORDER}`, background: WHITE, fontSize: 13, color: MUTED, cursor: 'pointer', fontWeight: 500, flexShrink: 0 }}>
          {loading ? '…' : '↻ Refresh'}
        </button>
      </div>

      {/* Stats */}
      {!loading && !error && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
          <Stat label="Total"       value={stats.total}      color={TEXT} />
          <Stat label="Open"        value={stats.open}       color={AMBER} />
          <Stat label="In Progress" value={stats.inProgress} color={BLUE} />
          <Stat label="Done"        value={stats.done}       color={GREEN} />
        </div>
      )}

      {/* Progress */}
      {!loading && !error && issues.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Progress issues={issues} />
        </div>
      )}

      {/* Charts */}
      {!loading && !error && issues.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10, marginBottom: 24 }}>
          <StatusChart   issues={issues} />
          <PriorityChart issues={issues} />
          <TypeChart     issues={issues} />
          <AgeChart      issues={issues} />
        </div>
      )}

      {/* Preset filters — horizontally scrollable on mobile */}
      <div style={{ overflowX: 'auto', marginBottom: 8, paddingBottom: 4 }}>
        <div style={{ display: 'flex', gap: 6, minWidth: 'max-content' }}>
          {PRESETS.map((p, i) => (
            <button key={i} onClick={() => handlePreset(i)}
              style={{ padding: '6px 14px', borderRadius: 99, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: `1px solid ${preset === i && !customJql ? GREEN : BORDER}`, background: preset === i && !customJql ? GREEN : WHITE, color: preset === i && !customJql ? WHITE : MUTED, whiteSpace: 'nowrap' }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search + type + sort */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8, marginBottom: 16 }}>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, flex: 1 }}>
          <input value={customJql} onChange={e => setCustomJql(e.target.value)} placeholder="Custom JQL…"
            style={{ flex: 1, padding: '7px 12px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 13, outline: 'none', background: WHITE, color: TEXT, minWidth: 0 }} />
          <button type="submit" style={{ padding: '7px 14px', borderRadius: 8, background: GREEN, color: WHITE, border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer', flexShrink: 0 }}>Search</button>
        </form>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TYPE_FILTERS.map(f => (
            <button key={f.value} onClick={() => setTypeFilter(f.value)}
              style={{ padding: '6px 12px', borderRadius: 99, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: `1px solid ${typeFilter === f.value ? GREEN : BORDER}`, background: typeFilter === f.value ? GREEN2 : WHITE, color: typeFilter === f.value ? GREEN : MUTED }}>
              {f.label}
            </button>
          ))}
          <select value={sortIdx} onChange={e => setSortIdx(Number(e.target.value))}
            style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${BORDER}`, fontSize: 12, background: WHITE, color: TEXT, cursor: 'pointer', outline: 'none' }}>
            {SORT_OPTIONS.map((o, i) => <option key={i} value={i}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', color: '#dc2626', marginBottom: 16, fontSize: 13 }}>{error}</div>}

      {/* Issue count */}
      {!error && <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>{loading ? 'Loading…' : `${displayed.length} of ${total} issues`}</div>}

      {/* Mobile: cards / Desktop: table */}
      {!error && !loading && isMobile && (
        <div>
          {displayed.map(issue => (
            <IssueCard key={issue.id} issue={issue} expanded={!!expanded[issue.id]} onToggle={() => toggle(issue.id)} />
          ))}
          {displayed.length === 0 && <div style={{ textAlign: 'center', padding: '40px 0', color: MUTED, fontSize: 14 }}>No issues found.</div>}
        </div>
      )}

      {!error && !isMobile && (
        <div style={{ background: WHITE, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {['Key','Summary','Status','Priority','Updated',''].map((h, i) => (
                  <th key={i} style={{ textAlign: 'left', padding: '10px 16px', fontSize: 11, fontWeight: 600, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', background: BG }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayed.map(issue => (
                <IssueRow key={issue.id} issue={issue} expanded={!!expanded[issue.id]} onToggle={() => toggle(issue.id)} />
              ))}
            </tbody>
          </table>
          {!loading && displayed.length === 0 && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: MUTED, fontSize: 14 }}>No issues found.</div>
          )}
        </div>
      )}
    </div>
  )
}
