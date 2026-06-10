import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api.js'

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

function nextDigest(lastIso) {
  if (!lastIso) return 'unknown'
  const last = new Date(lastIso)
  const next = new Date(last)
  next.setUTCDate(next.getUTCDate() + 1)
  const diffMs = next - Date.now()
  if (diffMs < 0) return 'imminent'
  const h = Math.floor(diffMs / 3_600_000)
  const m = Math.floor((diffMs % 3_600_000) / 60_000)
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
  const [name, setName]        = useState(initial?.name || '')
  const [desc, setDesc]        = useState(initial?.description || '')
  const [expiry, setExpiry]    = useState(initial?.expiry?.split('T')[0] || '')
  const [value, setValue]      = useState('')
  const [saving, setSaving]    = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      await onSave({ name: name.trim(), description: desc.trim(), expiry: expiry || null, value: value || undefined })
    } finally { setSaving(false) }
  }

  return (
    <form className="vault-form" onSubmit={handleSubmit}>
      <div className="vault-form-row">
        <input className="vault-input" placeholder="Key 名稱 (e.g. GROQ_API_KEY)" value={name}
          onChange={e => setName(e.target.value)} disabled={!!initial} required />
        <input className="vault-input" placeholder="說明 (選填)" value={desc}
          onChange={e => setDesc(e.target.value)} />
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
  const renderHealthy = (data.renderServices || []).filter(s => s.healthy).length
  const renderTotal = (data.renderServices || []).length
  const providerHealthy = data.providers.filter(p => !p.coolingDown).length
  const providerTotal = data.providers.length
  const healthyLocals = data.services.filter(s => s.healthy && s.latency != null)
  const avgLatency = healthyLocals.length
    ? Math.round(healthyLocals.reduce((a, s) => a + s.latency, 0) / healthyLocals.length)
    : null
  const allNominal = localHealthy === localTotal && renderHealthy === renderTotal && providerHealthy === providerTotal

  return (
    <div className="admin-health-strip">
      <HealthPill label="Local" ok={localHealthy} total={localTotal} />
      {renderTotal > 0 && <HealthPill label="Render" ok={renderHealthy} total={renderTotal} />}
      {providerTotal > 0 && <HealthPill label="AI" ok={providerHealthy} total={providerTotal} />}
      {avgLatency != null && (
        <span className={`admin-hp hp-lat ${latencyClass(avgLatency)}`}>avg {avgLatency}ms</span>
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
  const [collapsed, setCollapsed] = useState({})
  const [revealedKeys, setRevealedKeys]     = useState({})
  const [copyingKeys, setCopyingKeys]       = useState({})
  const [refreshingRender, setRefreshingRender] = useState(false)
  const toggleSection = (key) => setCollapsed(c => ({ ...c, [key]: !c[key] }))

  const refresh = useCallback(async () => {
    try {
      const [d, v] = await Promise.all([api.getAdminStatus(), api.getVault()])
      // capture latency trends before updating state
      const next = {}
      ;[...d.services, ...(d.renderServices || [])].forEach(svc => {
        const key = svc.label || svc.host
        const prev = prevLatency.current[key]
        if (prev != null && svc.latency != null) next[key] = svc.latency - prev
        prevLatency.current[key] = svc.latency
      })
      setData({ ...d, _trends: next })
      setVault(v)
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
    const id = setInterval(refresh, 10_000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'r' && !e.metaKey && !e.ctrlKey && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        refresh()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [refresh])

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
    const v = await api.getVault()
    setVault(v)
  }

  const handleVaultDelete = async (name) => {
    if (!confirm(`刪除 ${name}?`)) return
    await api.deleteVaultKey(name)
    const v = await api.getVault()
    setVault(v)
  }

  const handleForceRenderRefresh = async () => {
    setRefreshingRender(true)
    try {
      await api.forceRefreshRender()
      setTimeout(refresh, 3000)
    } catch {}
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

              {/* ATung Syncthing — live data from chusMBp Syncthing daemon */}
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
                      <span className="admin-svc-meta" style={{ fontSize: 11 }}>
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
                      {p.coolingDown && <span className="admin-cooldown"> · cooling until {new Date(p.cooldownUntil).toLocaleTimeString()}</span>}
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
              ok={vault?.entries ? vault.entries.filter(e => !e.expiryWarning).length : null}
              total={vault?.entries?.length ?? 0}
              right={
                <div className="vault-header-right">
                  {vault && !vault.vaultKeySet && (
                    <span className="vault-no-key">⚠️ VAULT_KEY 未設定，值不加密</span>
                  )}
                  <button className="btn btn-sm btn-ai" onClick={() => { setEditingKey(null); setShowVaultForm(v => !v) }}>
                    {showVaultForm ? '取消' : '+ 新增 Key'}
                  </button>
                </div>
              }
            />

            {showVaultForm && !editingKey && (
              <VaultForm onSave={handleVaultSave} onCancel={() => setShowVaultForm(false)} />
            )}

            {vault?.entries?.length > 0 ? (
              <div className="vault-table">
                <div className="vault-thead">
                  <span>名稱</span><span>說明</span><span>值</span><span>到期</span><span></span>
                </div>
                {vault.entries.map(e => (
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
            ) : (
              <div className="admin-info-card">
                <div className="admin-svc-meta">尚未加入任何 Key。點擊「+ 新增 Key」開始管理 API Keys。</div>
              </div>
            )}
          </section>

          {/* Watchdog + Digest */}
          <div className="admin-bottom-row">
            <section className="admin-section admin-section-half">
              <SectionHeader title="Watchdog (chusMBp)" />
              {(() => {
                const { time, message } = parseWatchdogLine(data.watchdog.lastLine)
                return (
                  <div className="admin-info-card">
                    {time && (
                      <div className="admin-svc-meta" style={{ fontSize: 10, marginBottom: 3 }}>
                        {elapsed(time.toISOString())} · {time.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei' })} Taipei
                      </div>
                    )}
                    <div className="admin-svc-meta" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                      {message || data.watchdog.lastLine}
                    </div>
                  </div>
                )
              })()}
            </section>

            <section className="admin-section admin-section-half">
              <SectionHeader
                title="Morning Digest"
                right={
                  <span className="admin-svc-meta" style={{ fontSize: 11 }}>
                    next {nextDigest(data.digest.lastDigestAt)} · 09:00 Taipei
                  </span>
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

        </div>
      )}
    </div>
  )
}
