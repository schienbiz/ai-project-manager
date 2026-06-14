import { useState, useEffect, useCallback, useRef } from 'react'
import { api, streamAgent } from '../api.js'

const PROJECT_ORDER = [
  'AI PM', '2560戰法', 'Marketing', 'AI Learning', 'Voice Trainer',
  'ROS', 'Intelligence Journal', 'Travel Advisor', 'Private Network', 'Leave Bot', 'Other'
]
const PROJECT_ICONS = {
  'AI PM': '🏢', '2560戰法': '📈', 'Marketing': '📣', 'AI Learning': '🎓',
  'Voice Trainer': '🎙', 'ROS': '💬', 'Intelligence Journal': '📰',
  'Travel Advisor': '✈️', 'Private Network': '🔒', 'Leave Bot': '📅', 'Other': '📦'
}
function groupByProject(entries) {
  const map = {}
  for (const e of entries) {
    const p = e.project || 'Other'
    if (!map[p]) map[p] = []
    map[p].push(e)
  }
  return PROJECT_ORDER.filter(p => map[p]).map(p => ({ project: p, entries: map[p] }))
}

function elapsed(iso) {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function parseWatchdogLine(line) {
  if (!line || line === 'no log') return { time: null, message: line }
  const m = line.match(/^\[watchdog\] (.+?\d{4}): (.+)$/)
  if (!m) return { time: null, message: line }
  const parsed = new Date(m[1])
  return { time: isNaN(parsed) ? null : parsed, message: m[2] }
}

function nextDigest() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
  }).formatToParts(new Date())
  const p = Object.fromEntries(parts.map(x => [x.type, +x.value]))
  const elapsedSec = p.hour * 3600 + p.minute * 60 + p.second
  const untilSec = (9 * 3600 - elapsedSec + 86400) % 86400 || 86400
  const h = Math.floor(untilSec / 3600)
  const m = Math.floor((untilSec % 3600) / 60)
  return `in ${h}h ${m}m`
}

function daysUntil(isoDate) {
  return Math.floor((new Date(isoDate) - Date.now()) / 86_400_000)
}

function latencyClass(ms) {
  if (ms == null) return ''
  if (ms < 100) return 'lat-fast'
  if (ms < 400) return 'lat-mid'
  return 'lat-slow'
}

function renderCacheAgeClass(s) {
  if (s == null) return ''
  if (s > 90) return 'cache-stale'
  if (s > 45) return 'cache-warn'
  return ''
}

function LatencyTrend({ delta }) {
  if (delta == null || Math.abs(delta) <= 10) return null
  return delta > 0
    ? <span className="trend-up"> ↑</span>
    : <span className="trend-down"> ↓</span>
}

function ExpiryBadge({ expiry }) {
  if (!expiry) return null
  const days = daysUntil(expiry)
  if (days < 0)   return <span className="vault-badge vault-badge-expired">過期</span>
  if (days <= 3)  return <span className="vault-badge vault-badge-danger">{days}天</span>
  if (days <= 7)  return <span className="vault-badge vault-badge-warn">{days}天</span>
  if (days <= 30) return <span className="vault-badge vault-badge-med">{days}天</span>
  return null
}

function expiryRowClass(expiry) {
  if (!expiry) return ''
  const days = daysUntil(expiry)
  if (days < 0)   return 'vault-row-expired'
  if (days <= 7)  return 'vault-row-danger'
  if (days <= 30) return 'vault-row-med'
  return ''
}

function VaultForm({ onSave, onCancel, initial }) {
  const [name, setName]     = useState(initial?.name || '')
  const [desc, setDesc]     = useState(initial?.description || '')
  const [proj, setProj]     = useState(initial?.project || 'AI PM')
  const [expiry, setExpiry] = useState(initial?.expiry?.split('T')[0] || '')
  const [value, setValue]   = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({ name: name.trim(), description: desc.trim(), project: proj, expiry: expiry || null, value: value || undefined })
    } finally { setSaving(false) }
  }

  return (
    <form className="vault-form" onSubmit={handleSubmit}>
      <div className="vault-form-row">
        <input className="vault-input" placeholder="Key 名稱 (e.g. GROQ_API_KEY)" value={name}
          onChange={e => setName(e.target.value)} disabled={!!initial} required />
        <input className="vault-input" placeholder="說明 (選填)" value={desc}
          onChange={e => setDesc(e.target.value)} />
        <select className="vault-input vault-input-proj" value={proj} onChange={e => setProj(e.target.value)}>
          {PROJECT_ORDER.map(p => <option key={p} value={p}>{PROJECT_ICONS[p]} {p}</option>)}
        </select>
      </div>
      <div className="vault-form-row">
        <input className="vault-input vault-input-date" type="date" value={expiry}
          onChange={e => setExpiry(e.target.value)} title="到期日 (選填)" />
        <input className="vault-input vault-input-value" type="password" placeholder="Key 值 (選填，留空保持不變)" value={value}
          onChange={e => setValue(e.target.value)} />
      </div>
      <div className="vault-form-actions">
        <button className="btn btn-sm btn-ai" type="submit" disabled={saving}>{saving ? '…' : '儲存'}</button>
        <button className="btn btn-sm" type="button" onClick={onCancel}>取消</button>
      </div>
    </form>
  )
}

function HealthPill({ label, ok, total }) {
  const allOk = ok === total
  return (
    <span className={`admin-hp ${allOk ? 'hp-ok' : 'hp-warn'}`}>
      <span className={`admin-dot ${allOk ? 'dot-ok' : 'dot-warn'}`} style={{ width: 6, height: 6, flexShrink: 0 }} />
      {label} <strong>{ok}/{total}</strong>
    </span>
  )
}

function HealthStrip({ data }) {
  const localHealthy = data.services.filter(s => s.healthy).length
  const localTotal = data.services.length
  const atungHealthy = (data.atungServices || []).filter(s => s.healthy).length
  const atungTotal = (data.atungServices || []).length
  const renderHealthy = (data.renderServices || []).filter(s => s.healthy).length
  const renderTotal = (data.renderServices || []).length
  const providerHealthy = data.providers.filter(p => !p.coolingDown).length
  const providerTotal = data.providers.length
  const healthyLocals = data.services.filter(s => s.healthy && s.latency != null)
  const avgLatency = healthyLocals.length
    ? Math.round(healthyLocals.reduce((a, s) => a + s.latency, 0) / healthyLocals.length)
    : null
  const healthyRenders = (data.renderServices || []).filter(s => s.healthy && s.latency != null)
  const renderAvg = healthyRenders.length
    ? Math.round(healthyRenders.reduce((a, s) => a + s.latency, 0) / healthyRenders.length)
    : null
  const allNominal = localHealthy === localTotal && atungHealthy === atungTotal && renderHealthy === renderTotal && providerHealthy === providerTotal

  return (
    <div className="admin-health-strip">
      <HealthPill label="Local" ok={localHealthy} total={localTotal} />
      {atungTotal > 0 && <HealthPill label="ATung" ok={atungHealthy} total={atungTotal} />}
      {renderTotal > 0 && <HealthPill label="Render" ok={renderHealthy} total={renderTotal} />}
      {providerTotal > 0 && <HealthPill label="AI" ok={providerHealthy} total={providerTotal} />}
      {avgLatency != null && (
        <span className={`admin-hp hp-lat ${latencyClass(avgLatency)}`}>avg local {avgLatency}ms</span>
      )}
      {renderAvg != null && (
        <span className={`admin-hp hp-lat ${latencyClass(renderAvg)}`}>avg render {renderAvg}ms</span>
      )}
      <span className={`admin-hs-status ${allNominal ? 'hs-ok' : 'hs-warn'}`}>
        {allNominal ? '✓ All nominal' : '⚠ Issues detected'}
      </span>
    </div>
  )
}

function SectionHeader({ title, ok, total, right, collapsed, onToggle }) {
  const hasBadge = total != null && total > 0
  const allOk = ok == null || ok === total
  return (
    <div className="admin-section-hdr" onClick={onToggle} style={onToggle ? { cursor: 'pointer', userSelect: 'none' } : undefined}>
      <span className="admin-section-title">
        {onToggle && <span className="admin-collapse-arrow">{collapsed ? '▶' : '▼'}</span>}
        {title}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={e => e.stopPropagation()}>
        {right}
        {hasBadge && (
          <span className={`admin-section-cnt ${allOk ? 'cnt-ok' : 'cnt-warn'}`}>
            {ok != null ? `${ok}/${total}` : total}
          </span>
        )}
      </div>
    </div>
  )
}

export default function AdminDashboard({ onBack }) {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [restarting, setRestarting] = useState({})
  const [confirmRestart, setConfirmRestart] = useState(null)
  const [error, setError]       = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const prevLatency = useRef({})

  const [vault, setVault]       = useState(null)
  const [showVaultForm, setShowVaultForm] = useState(false)
  const [editingKey, setEditingKey] = useState(null)
  const [collapsed, setCollapsed] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('admin-collapsed') || '{}'); return { vault: true, ...s } } catch { return { vault: true } }
  })
  const [revealedKeys, setRevealedKeys]   = useState({})
  const [copyingKeys, setCopyingKeys]     = useState({})
  const [refreshingRender, setRefreshingRender] = useState(false)
  const [sendingDigest, setSendingDigest] = useState(false)
  const [auditRunning, setAuditRunning]       = useState(false)
  const [auditSteps, setAuditSteps]           = useState([])
  const [auditOutput, setAuditOutput]         = useState('')
  const [agentAnalysisRunning, setAgentAnalysisRunning] = useState(false)
  const [agentAnalysisOutput, setAgentAnalysisOutput]   = useState('')
  const [optimizePreview, setOptimizePreview]           = useState(null)   // parsed actions array
  const [optimizePreviewLoading, setOptimizePreviewLoading] = useState(false)
  const [optimizeRunning, setOptimizeRunning]           = useState(false)
  const [optimizeSteps, setOptimizeSteps]               = useState([])
  const [optimizeOutput, setOptimizeOutput]             = useState('')
  const [vaultSearch, setVaultSearch]     = useState('')
  const [vaultProject, setVaultProject]   = useState('All')
  const [vaultCollapsed, setVaultCollapsed] = useState({})
  const toggleSection = (key) => setCollapsed(c => ({ ...c, [key]: !c[key] }))

  const loadVault = useCallback(async () => {
    try { setVault(await api.getVault()) } catch {}
  }, [])

  const refresh = useCallback(async () => {
    try {
      const d = await api.getAdminStatus()
      const next = {}
      ;[...d.services, ...(d.atungServices || []), ...(d.renderServices || [])].forEach(svc => {
        const key = svc.label || svc.host
        const prev = prevLatency.current[key]
        if (prev != null && svc.latency != null) next[key] = svc.latency - prev
        prevLatency.current[key] = svc.latency
      })
      setData({ ...d, _trends: next })
      setLastRefresh(new Date())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    loadVault()
    const id = setInterval(refresh, 10_000)
    return () => clearInterval(id)
  }, [refresh, loadVault])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        refresh()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refresh])

  useEffect(() => {
    try { localStorage.setItem('admin-collapsed', JSON.stringify(collapsed)) } catch {}
  }, [collapsed])

  const handleRestart = async (label, name) => {
    if (confirmRestart !== label) { setConfirmRestart(label); return }
    setConfirmRestart(null)
    setRestarting(r => ({ ...r, [label]: true }))
    try {
      await api.restartService(label)
      setTimeout(refresh, 2000)
    } catch (e) {
      alert(`Restart failed: ${e.message}`)
    } finally {
      setRestarting(r => ({ ...r, [label]: false }))
    }
  }

  const handleVaultSave = async (formData) => {
    await api.upsertVaultKey(formData)
    setShowVaultForm(false)
    setEditingKey(null)
    await loadVault()
  }

  const handleVaultDelete = async (name) => {
    if (!confirm(`刪除 ${name}?`)) return
    await api.deleteVaultKey(name)
    await loadVault()
  }

  const handleSendDigest = async () => {
    if (!confirm('立即發送 Morning Digest 到 Telegram？')) return
    setSendingDigest(true)
    try {
      await api.sendDigestNow()
      setTimeout(refresh, 1500)
    } catch (e) { alert('Send failed: ' + e.message) }
    finally { setTimeout(() => setSendingDigest(false), 2000) }
  }

  const handleAgentAnalysis = useCallback(async () => {
    setAgentAnalysisRunning(true)
    setAgentAnalysisOutput('')
    setOptimizePreview(null)
    setOptimizeSteps([])
    setOptimizeOutput('')
    await streamAgent(
      '/pm/api/admin/agent-analysis',
      {},
      null,
      (chunk) => setAgentAnalysisOutput(prev => prev + chunk),
      () => setAgentAnalysisRunning(false),
      (err) => { setAgentAnalysisOutput(`❌ 錯誤: ${err}`); setAgentAnalysisRunning(false) }
    )
  }, [])

  const handleOptimizePreview = useCallback(async (analysisText) => {
    setOptimizePreviewLoading(true)
    setOptimizePreview(null)
    setOptimizeSteps([])
    setOptimizeOutput('')
    try {
      const r = await fetch('/pm/api/admin/agent-optimize/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisText })
      })
      const plan = await r.json()
      setOptimizePreview(plan.actions?.length ? plan.actions : [])
    } catch (e) {
      setOptimizeSteps([`❌ 預覽失敗: ${e.message}`])
    } finally {
      setOptimizePreviewLoading(false)
    }
  }, [])

  const handleOptimizeApply = useCallback(async (actions) => {
    setOptimizeRunning(true)
    setOptimizeSteps([])
    setOptimizeOutput('')
    setOptimizePreview(null)
    await streamAgent(
      '/pm/api/admin/agent-optimize',
      { actions },
      (s) => setOptimizeSteps(prev => [...prev, s]),
      (chunk) => setOptimizeOutput(prev => prev + chunk),
      () => setOptimizeRunning(false),
      (err) => { setOptimizeSteps(prev => [...prev, `❌ 錯誤: ${err}`]); setOptimizeRunning(false) }
    )
  }, [])

  const handleRunAudit = useCallback(async () => {
    setAuditRunning(true)
    setAuditSteps([])
    setAuditOutput('')
    await streamAgent(
      '/pm/api/admin/audit',
      {},
      (s) => setAuditSteps(prev => [...prev, s]),
      (chunk) => setAuditOutput(prev => prev + chunk),
      () => setAuditRunning(false),
      (err) => { setAuditSteps(prev => [...prev, `❌ 錯誤: ${err}`]); setAuditRunning(false) }
    )
  }, [])

  const handleForceRenderRefresh = async () => {
    setRefreshingRender(true)
    try {
      await api.forceRefreshRender()
      setTimeout(refresh, 3000)
    } catch (e) { console.error('Force render refresh failed:', e) }
    setTimeout(() => setRefreshingRender(false), 3500)
  }

  const handleReveal = async (name) => {
    if (revealedKeys[name] != null) {
      setRevealedKeys(r => { const n = { ...r }; delete n[name]; return n })
      return
    }
    try {
      const { value } = await api.revealVaultKey(name)
      setRevealedKeys(r => ({ ...r, [name]: value ?? '(no value)' }))
    } catch (e) { alert(`Reveal failed: ${e.message}`) }
  }

  const handleCopy = async (name) => {
    try {
      let value = revealedKeys[name]
      if (value == null) { const res = await api.revealVaultKey(name); value = res.value }
      await navigator.clipboard.writeText(value ?? '')
      setCopyingKeys(c => ({ ...c, [name]: true }))
      setTimeout(() => setCopyingKeys(c => { const n = { ...c }; delete n[name]; return n }), 1500)
    } catch (e) { alert(`Copy failed: ${e.message}`) }
  }

  return (
    <div className="admin-dashboard">
      <div className="admin-header">
        <div className="admin-title-row">
          <button className="btn btn-sm" onClick={onBack}>← Back</button>
          <h2>⚙️ System Admin</h2>
          <span className="admin-refresh-info">
            {lastRefresh ? `updated ${elapsed(lastRefresh.toISOString())}` : ''} · auto-refresh 10s
          </span>
          <button className="btn btn-sm btn-ai" onClick={refresh} title="Refresh (R)">↺ Refresh</button>
          <span className="admin-shortcut-hint"><kbd>R</kbd> to refresh</span>
        </div>
        {data && <HealthStrip data={data} />}
      </div>

      {loading && <div className="admin-loading">Checking services…</div>}
      {error   && <div className="admin-error">⚠️ {error}</div>}

      {data && (
        <div className="admin-body">

          {/* Local Services */}
          <section className="admin-section">
            <SectionHeader
              title="Local Services (chusMBp)"
              ok={data.services.filter(s => s.healthy).length}
              total={data.services.length}
              collapsed={collapsed.local}
              onToggle={() => toggleSection('local')}
            />
            {!collapsed.local && <div className="admin-service-grid-2col">
              {data.services.map(svc => (
                <div key={svc.label} className={`admin-service-card ${svc.healthy ? 'healthy' : 'unhealthy'}`}>
                  <div className="admin-svc-left">
                    <span className={`admin-dot ${svc.healthy ? 'dot-ok' : 'dot-err'}`} />
                    <div>
                      <div className="admin-svc-name">{svc.name}</div>
                      <div className="admin-svc-meta">
                        :{svc.port} · {svc.status || 'no response'} · <span className={latencyClass(svc.latency)}>{svc.latency}ms<LatencyTrend delta={data._trends?.[svc.label]} /></span>
                      </div>
                    </div>
                  </div>
                  {confirmRestart === svc.label ? (
                    <span className="admin-restart-confirm">
                      Sure?
                      <button className="btn btn-sm btn-danger" onClick={() => handleRestart(svc.label, svc.name)}>✓</button>
                      <button className="btn btn-sm" onClick={() => setConfirmRestart(null)}>✕</button>
                    </span>
                  ) : (
                    <button
                      className="btn btn-sm"
                      disabled={restarting[svc.label]}
                      onClick={() => handleRestart(svc.label, svc.name)}
                    >
                      {restarting[svc.label] ? '…' : 'Restart'}
                    </button>
                  )}
                </div>
              ))}

              {/* ATung Syncthing */}
              {(() => {
                const st = data.syncthing
                const connected = st?.connected
                const pct = st?.completion
                const needMB = st?.needBytes ? (st.needBytes / 1_048_576).toFixed(1) : null
                const dotClass = connected == null ? 'dot-info' : connected ? 'dot-ok' : 'dot-err'
                const meta = connected == null
                  ? 'querying…'
                  : connected
                    ? `connected · ${pct === 100 ? '✓ in sync' : `${pct?.toFixed(1)}% · ${needMB}MB pending`}`
                    : 'disconnected — check ATung watchdog'
                return (
                  <div className="admin-service-card admin-svc-atung">
                    <div className="admin-svc-left">
                      <span className={`admin-dot ${dotClass}`} />
                      <div>
                        <div className="admin-svc-name">ATung Syncthing</div>
                        <div className="admin-svc-meta">{meta}</div>
                      </div>
                    </div>
                    <span className="admin-atung-badge">ATung</span>
                  </div>
                )
              })()}
            </div>}
          </section>

          {/* ATung Mac Services */}
          {data.atungServices && data.atungServices.length > 0 && (
            <section className="admin-section">
              <SectionHeader
                title="ATung Mac Services"
                ok={data.atungServices.filter(s => s.healthy).length}
                total={data.atungServices.length}
                collapsed={collapsed.atung}
                onToggle={() => toggleSection('atung')}
              />
              {!collapsed.atung && <div className="admin-service-grid-2col">
                {data.atungServices.map(svc => (
                  <div key={`${svc.host}:${svc.port}`} className={`admin-service-card ${svc.healthy ? 'healthy' : 'unhealthy'}`}>
                    <div className="admin-svc-left">
                      <span className={`admin-dot ${svc.healthy ? 'dot-ok' : 'dot-err'}`} />
                      <div>
                        <div className="admin-svc-name">{svc.name}</div>
                        <div className="admin-svc-meta">
                          :{svc.port} · {svc.status || 'no response'} · <span className={latencyClass(svc.latency)}>{svc.latency}ms<LatencyTrend delta={data._trends?.[svc.label]} /></span>
                        </div>
                      </div>
                    </div>
                    <span className="admin-atung-badge">ATung</span>
                  </div>
                ))}
              </div>}
            </section>
          )}

          {/* Render Services */}
          {data.renderServices && (
            <section className="admin-section">
              <SectionHeader
                title="Render Services (外部)"
                ok={data.renderServices.filter(s => s.healthy).length}
                total={data.renderServices.length}
                collapsed={collapsed.render}
                onToggle={() => toggleSection('render')}
                right={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {data.renderCacheAge != null && (
                      <span className={`admin-svc-meta ${renderCacheAgeClass(data.renderCacheAge)}`} style={{ fontSize: 11 }}>
                        cached {data.renderCacheAge < 60 ? `${data.renderCacheAge}s` : `${Math.floor(data.renderCacheAge / 60)}m`} ago · auto-refresh 60s
                      </span>
                    )}
                    <button className="btn btn-sm" onClick={handleForceRenderRefresh} disabled={refreshingRender} title="Force refresh now">
                      {refreshingRender ? '…' : '↺ Now'}
                    </button>
                  </div>
                }
              />
              {!collapsed.render && <div className="admin-service-grid-2col">
                {data.renderServices.map(svc => (
                  <div
                    key={svc.host}
                    className={`admin-service-card admin-service-card-link ${svc.healthy ? 'healthy' : 'unhealthy'}`}
                    onClick={() => window.open(`https://${svc.host}`, '_blank')}
                    title={`Open https://${svc.host}`}
                  >
                    <div className="admin-svc-left">
                      <span className={`admin-dot ${svc.healthy ? 'dot-ok' : 'dot-err'}`} />
                      <div>
                        <div className="admin-svc-name">{svc.name}</div>
                        <div className="admin-svc-meta admin-svc-meta-ellipsis">
                          {svc.host} · {svc.status || 'no response'} · <span className={latencyClass(svc.latency)}>{svc.latency}ms<LatencyTrend delta={data._trends?.[svc.host]} /></span>
                        </div>
                      </div>
                    </div>
                    <span className={`admin-svc-meta render-status-badge ${svc.healthy ? 'render-ok' : 'render-err'}`}>
                      {svc.healthy ? 'UP ↗' : 'DOWN'}
                    </span>
                  </div>
                ))}
              </div>}
            </section>
          )}

          {/* AI Providers */}
          <section className="admin-section">
            <SectionHeader
              title="AI Providers"
              ok={data.providers.filter(p => !p.coolingDown).length}
              total={data.providers.length}
              collapsed={collapsed.providers}
              onToggle={() => toggleSection('providers')}
            />
            {!collapsed.providers && <div className="admin-provider-grid-3col">
              {data.providers.map(p => (
                <div key={p.name} className={`admin-provider-card ${p.coolingDown ? 'cooling' : 'ready'}`}>
                  <span className={`admin-dot ${p.coolingDown ? 'dot-warn' : 'dot-ok'}`} />
                  <div style={{ minWidth: 0 }}>
                    <div className="admin-svc-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {p.name}
                      {(p.stats?.ok > 0 || p.stats?.err > 0) && (
                        <span className="admin-provider-stat">
                          {p.stats.ok}✓{p.stats.err > 0 && <span className="stat-err"> {p.stats.err}✗</span>}
                        </span>
                      )}
                    </div>
                    <div className="admin-svc-meta admin-svc-meta-ellipsis" style={{ fontFamily: 'monospace', fontSize: 10 }}>
                      {p.model}
                      {p.coolingDown
                        ? <span className="admin-cooldown"> · cooling until {new Date(p.cooldownUntil).toLocaleTimeString()}</span>
                        : p.stats?.lastUsed ? <span> · {elapsed(p.stats.lastUsed)}</span> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>}
          </section>

          {/* API Key Vault */}
          <section className="admin-section">
            <SectionHeader
              title="API Key Vault"
              total={vault?.entries?.length ?? 0}
              collapsed={collapsed.vault}
              onToggle={() => toggleSection('vault')}
              right={
                <div className="vault-header-right">
                  {vault && !vault.vaultKeySet && (
                    <span className="vault-no-key">⚠️ VAULT_KEY 未設定，值不加密</span>
                  )}
                  <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); handleAgentAnalysis() }} disabled={agentAnalysisRunning} title="分析 AI Agent 服務是否需要更新">
                    {agentAnalysisRunning ? '分析中…' : '🤖 分析更新'}
                  </button>
                  <button className="btn btn-sm btn-ai" onClick={(e) => { e.stopPropagation(); setEditingKey(null); setShowVaultForm(v => !v) }}>
                    {showVaultForm ? '取消' : '+ 新增 Key'}
                  </button>
                </div>
              }
            />

            {agentAnalysisOutput && (
              <div className="audit-panel" style={{ marginBottom: 8 }}>
                <div className="audit-output">{agentAnalysisOutput}</div>
                {!agentAnalysisRunning && optimizePreview === null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                    <button
                      className="btn btn-sm btn-ai"
                      onClick={() => handleOptimizePreview(agentAnalysisOutput)}
                      disabled={optimizePreviewLoading}
                    >
                      {optimizePreviewLoading ? '分析中…' : '⚡ 自動優化'}
                    </button>
                  </div>
                )}
                {optimizePreview !== null && !optimizeRunning && (
                  <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    {optimizePreview.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>✅ 無需更新</div>
                    ) : (
                      <>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>預覽變更（確認後才套用）：</div>
                        {optimizePreview.map((a, i) => (
                          <div key={i} className="audit-step" style={{ marginBottom: 3 }}>
                            <strong>{a.service}</strong> · {a.provider}: <code style={{ fontSize: 10 }}>{a.old_model}</code> → <code style={{ fontSize: 10 }}>{a.new_model}</code>
                            {a.reason && <span style={{ color: 'var(--muted)', marginLeft: 6 }}>({a.reason})</span>}
                          </div>
                        ))}
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button className="btn btn-sm btn-ai" onClick={() => handleOptimizeApply(optimizePreview)}>✅ 確認套用</button>
                          <button className="btn btn-sm" onClick={() => setOptimizePreview(null)}>✗ 取消</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {(optimizeSteps.length > 0 || optimizeOutput) && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div className="audit-steps">
                      {optimizeSteps.map((s, i) => <div key={i} className="audit-step">{s}</div>)}
                    </div>
                    {optimizeOutput && <div className="audit-output" style={{ marginTop: 4 }}>{optimizeOutput}</div>}
                  </div>
                )}
              </div>
            )}

            {!collapsed.vault && showVaultForm && !editingKey && (
              <VaultForm onSave={handleVaultSave} onCancel={() => setShowVaultForm(false)} />
            )}

            {!collapsed.vault && vault?.entries?.length > 0 && (
              <div className="vault-toolbar">
                <input
                  className="vault-search"
                  placeholder="搜尋 Key 名稱或說明…"
                  value={vaultSearch}
                  onChange={e => setVaultSearch(e.target.value)}
                />
                <select className="vault-input vault-filter-proj" value={vaultProject} onChange={e => setVaultProject(e.target.value)}>
                  <option value="All">All Projects</option>
                  {PROJECT_ORDER.map(p => <option key={p} value={p}>{PROJECT_ICONS[p]} {p}</option>)}
                </select>
              </div>
            )}

            {!collapsed.vault && vault?.entries?.length > 0 ? (() => {
              const filtered = vault.entries.filter(e =>
                (vaultProject === 'All' || e.project === vaultProject) &&
                (!vaultSearch || e.name.toLowerCase().includes(vaultSearch.toLowerCase()) ||
                  (e.description || '').toLowerCase().includes(vaultSearch.toLowerCase()))
              )
              const groups = (vaultSearch || vaultProject !== 'All')
                ? [{ project: vaultProject === 'All' ? '搜尋結果' : vaultProject, entries: filtered }]
                : groupByProject(filtered)
              return groups.map(({ project: grpName, entries: grpEntries }) => (
                <div key={grpName} className="vault-project-group">
                  <div className="vault-project-hdr" onClick={() => setVaultCollapsed(c => ({ ...c, [grpName]: !c[grpName] }))}>
                    <span>{PROJECT_ICONS[grpName] || '📦'} {grpName}</span>
                    <span className="vault-project-cnt">{vaultCollapsed[grpName] ? '▶' : '▼'} {grpEntries.length}</span>
                  </div>
                  {!vaultCollapsed[grpName] && (
                    <div className="vault-table">
                      <div className="vault-thead">
                        <span>名稱</span><span>說明</span><span>值</span><span>到期</span><span></span>
                      </div>
                      {grpEntries.map(e => (
                        <div key={e.name}>
                          {editingKey === e.name ? (
                            <VaultForm
                              initial={e}
                              onSave={async (d) => { await handleVaultSave(d); setEditingKey(null) }}
                              onCancel={() => setEditingKey(null)}
                            />
                          ) : (
                            <div className={`vault-row ${expiryRowClass(e.expiry)}`}>
                              <span className="vault-cell-name">{e.name}</span>
                              <span className="vault-cell-desc">{e.description || '—'}</span>
                              <span className="vault-cell-val" title={revealedKeys[e.name] || undefined}>
                                {revealedKeys[e.name] != null
                                  ? <span className="vault-val-revealed">{revealedKeys[e.name].length > 38 ? revealedKeys[e.name].slice(0, 38) + '…' : revealedKeys[e.name]}</span>
                                  : (e.maskedValue || '—')}
                              </span>
                              <span className="vault-cell-expiry">
                                {e.expiry ? (
                                  <><ExpiryBadge expiry={e.expiry} /> <span className="admin-svc-meta">{e.expiry.split('T')[0]}</span></>
                                ) : '—'}
                              </span>
                              <span className="vault-cell-actions">
                                <button className="btn btn-sm vault-btn-icon" title="Copy value" onClick={() => handleCopy(e.name)}>
                                  {copyingKeys[e.name] ? '✓' : '⎘'}
                                </button>
                                <button className="btn btn-sm vault-btn-icon" title={revealedKeys[e.name] != null ? 'Hide' : 'Reveal'} onClick={() => handleReveal(e.name)}>
                                  {revealedKeys[e.name] != null ? '●' : '○'}
                                </button>
                                <button className="btn btn-sm" onClick={() => setEditingKey(e.name)}>編輯</button>
                                <button className="btn btn-sm btn-danger" onClick={() => handleVaultDelete(e.name)}>刪除</button>
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            })() : (
              !collapsed.vault && (
                <div className="admin-info-card">
                  <div className="admin-svc-meta">尚未加入任何 Key。點擊「+ 新增 Key」開始管理 API Keys。</div>
                </div>
              )
            )}
          </section>

          {/* Watchdog + Digest */}
          <div className="admin-bottom-row">
            <section className="admin-section admin-section-half">
              <SectionHeader title="Watchdog (chusMBp)" />
              <div className="admin-info-card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(data.watchdog.lines || [data.watchdog.lastLine]).map((line, i) => {
                  const { time, message } = parseWatchdogLine(line)
                  return (
                    <div key={i} style={{ opacity: i === 0 ? 1 : 0.55 }}>
                      {time && (
                        <div className="admin-svc-meta" style={{ fontSize: 10, marginBottom: 1 }}>
                          {elapsed(time.toISOString())} · {time.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei' })} Taipei
                        </div>
                      )}
                      <div className="admin-svc-meta" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                        {message || line}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="admin-section admin-section-half">
              <SectionHeader
                title="Morning Digest"
                right={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="admin-svc-meta" style={{ fontSize: 11 }}>
                      next {nextDigest()} · 09:00 Taipei
                    </span>
                    <button className="btn btn-sm btn-ai" onClick={handleSendDigest} disabled={sendingDigest} title="立即發送">
                      {sendingDigest ? '…' : '↑ Now'}
                    </button>
                  </div>
                }
              />
              <div className="admin-info-card">
                <div className="admin-svc-name">Last sent</div>
                <div className="admin-svc-meta">
                  {data.digest.lastDigestAt
                    ? `${elapsed(data.digest.lastDigestAt)} (${new Date(data.digest.lastDigestAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })} Taipei)`
                    : 'Never'}
                </div>
              </div>
            </section>
          </div>

          {/* 全系統稽核 */}
          <section className="admin-section">
            <SectionHeader
              title="全系統稽核"
              right={
                <button className="btn btn-sm btn-ai" onClick={handleRunAudit} disabled={auditRunning}>
                  {auditRunning ? '稽核中…' : '▶ 執行稽核'}
                </button>
              }
            />
            {(auditSteps.length > 0 || auditOutput) && (
              <div className="audit-panel">
                <div className="audit-steps">
                  {auditSteps.map((s, i) => (
                    <div key={i} className="audit-step">{s}</div>
                  ))}
                </div>
                {auditOutput && (
                  <div className="audit-output">{auditOutput}</div>
                )}
              </div>
            )}
          </section>

        </div>
      )}
    </div>
  )
}
