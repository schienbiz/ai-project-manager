import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'

function elapsed(iso) {
  if (!iso) return '—'
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
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

function ExpiryBadge({ expiry }) {
  if (!expiry) return null
  const days = daysUntil(expiry)
  if (days < 0)  return <span className="vault-badge vault-badge-expired">過期</span>
  if (days <= 3)  return <span className="vault-badge vault-badge-danger">{days}天</span>
  if (days <= 7)  return <span className="vault-badge vault-badge-warn">{days}天</span>
  return <span className="vault-badge vault-badge-ok">{days}天</span>
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

function SectionHeader({ title, ok, total, right }) {
  const allOk = ok == null || ok === total
  return (
    <div className="admin-section-hdr">
      <span className="admin-section-title">{title}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {right}
        {total > 0 && (
          <span className={`admin-section-cnt ${allOk ? 'cnt-ok' : 'cnt-warn'}`}>
            {ok}/{total}
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
  const [error, setError]       = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  const [vault, setVault]       = useState(null)
  const [showVaultForm, setShowVaultForm] = useState(false)
  const [editingKey, setEditingKey] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [d, v] = await Promise.all([api.getAdminStatus(), api.getVault()])
      setData(d)
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

  const handleRestart = async (label, name) => {
    if (!confirm(`Restart ${name}?`)) return
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

  return (
    <div className="admin-dashboard">
      <div className="admin-header">
        <div className="admin-title-row">
          <button className="btn btn-sm" onClick={onBack}>← Back</button>
          <h2>⚙️ System Admin</h2>
          <span className="admin-refresh-info">
            {lastRefresh ? `updated ${elapsed(lastRefresh.toISOString())}` : ''} · auto-refresh 10s
          </span>
          <button className="btn btn-sm btn-ai" onClick={refresh}>↺ Refresh</button>
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
            />
            <div className="admin-service-grid-2col">
              {data.services.map(svc => (
                <div key={svc.label} className={`admin-service-card ${svc.healthy ? 'healthy' : 'unhealthy'}`}>
                  <div className="admin-svc-left">
                    <span className={`admin-dot ${svc.healthy ? 'dot-ok' : 'dot-err'}`} />
                    <div>
                      <div className="admin-svc-name">{svc.name}</div>
                      <div className="admin-svc-meta">
                        :{svc.port} · {svc.status || 'no response'} · <span className={latencyClass(svc.latency)}>{svc.latency}ms</span>
                      </div>
                    </div>
                  </div>
                  <button
                    className="btn btn-sm"
                    disabled={restarting[svc.label]}
                    onClick={() => handleRestart(svc.label, svc.name)}
                  >
                    {restarting[svc.label] ? '…' : 'Restart'}
                  </button>
                </div>
              ))}

              {/* ATung Syncthing */}
              <div className="admin-service-card admin-svc-atung">
                <div className="admin-svc-left">
                  <span className="admin-dot dot-info" />
                  <div>
                    <div className="admin-svc-name">ATung Syncthing</div>
                    <div className="admin-svc-meta">monitored by ATung watchdog · Telegram alerts on failure</div>
                  </div>
                </div>
                <span className="admin-atung-badge">ATung</span>
              </div>
            </div>
          </section>

          {/* Render Services */}
          {data.renderServices && (
            <section className="admin-section">
              <SectionHeader
                title="Render Services (外部)"
                ok={data.renderServices.filter(s => s.healthy).length}
                total={data.renderServices.length}
                right={data.renderCacheAge != null && (
                  <span className="admin-svc-meta" style={{ fontSize: 11 }}>
                    cached {data.renderCacheAge < 60 ? `${data.renderCacheAge}s` : `${Math.floor(data.renderCacheAge / 60)}m`} ago · auto-refresh 60s
                  </span>
                )}
              />
              <div className="admin-service-grid-2col">
                {data.renderServices.map(svc => (
                  <div key={svc.host} className={`admin-service-card ${svc.healthy ? 'healthy' : 'unhealthy'}`}>
                    <div className="admin-svc-left">
                      <span className={`admin-dot ${svc.healthy ? 'dot-ok' : 'dot-err'}`} />
                      <div>
                        <div className="admin-svc-name">{svc.name}</div>
                        <div className="admin-svc-meta admin-svc-meta-ellipsis">
                          {svc.host} · {svc.status || 'no response'} · <span className={latencyClass(svc.latency)}>{svc.latency}ms</span>
                        </div>
                      </div>
                    </div>
                    <span className={`admin-svc-meta render-status-badge ${svc.healthy ? 'render-ok' : 'render-err'}`}>
                      {svc.healthy ? 'UP' : 'DOWN'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* AI Providers */}
          <section className="admin-section">
            <SectionHeader
              title="AI Providers"
              ok={data.providers.filter(p => !p.coolingDown).length}
              total={data.providers.length}
            />
            <div className="admin-provider-grid-3col">
              {data.providers.map(p => (
                <div key={p.name} className={`admin-provider-card ${p.coolingDown ? 'cooling' : 'ready'}`}>
                  <span className={`admin-dot ${p.coolingDown ? 'dot-warn' : 'dot-ok'}`} />
                  <div style={{ minWidth: 0 }}>
                    <div className="admin-svc-name">{p.name}</div>
                    <div className="admin-svc-meta admin-svc-meta-ellipsis" style={{ fontFamily: 'monospace', fontSize: 10 }}>
                      {p.model}
                      {p.coolingDown && <span className="admin-cooldown"> · cooling until {new Date(p.cooldownUntil).toLocaleTimeString()}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* API Key Vault */}
          <section className="admin-section">
            <div className="admin-section-hdr">
              <span className="admin-section-title">API Key Vault</span>
              <div className="vault-header-right">
                {vault && !vault.vaultKeySet && (
                  <span className="vault-no-key">⚠️ VAULT_KEY 未設定，值不加密</span>
                )}
                <button className="btn btn-sm btn-ai" onClick={() => { setEditingKey(null); setShowVaultForm(v => !v) }}>
                  {showVaultForm ? '取消' : '+ 新增 Key'}
                </button>
              </div>
            </div>

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
                      <div className={`vault-row ${e.expiryWarning ? 'vault-row-warn' : ''}`}>
                        <span className="vault-cell-name">{e.name}</span>
                        <span className="vault-cell-desc">{e.description || '—'}</span>
                        <span className="vault-cell-val">{e.maskedValue || '—'}</span>
                        <span className="vault-cell-expiry">
                          {e.expiry ? (
                            <><ExpiryBadge expiry={e.expiry} /> <span className="admin-svc-meta">{e.expiry.split('T')[0]}</span></>
                          ) : '—'}
                        </span>
                        <span className="vault-cell-actions">
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
              <div className="admin-section-title">Watchdog (chusMBp)</div>
              <div className="admin-info-card">
                <div className="admin-svc-meta" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {data.watchdog.lastLine}
                </div>
              </div>
            </section>

            <section className="admin-section admin-section-half">
              <div className="admin-section-title">Morning Digest</div>
              <div className="admin-info-card">
                <div className="admin-svc-name">Last sent</div>
                <div className="admin-svc-meta">
                  {data.digest.lastDigestAt
                    ? `${elapsed(data.digest.lastDigestAt)} (${new Date(data.digest.lastDigestAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })} Taipei)`
                    : 'Never'}
                </div>
                <div className="admin-svc-name" style={{ marginTop: 6 }}>Next run</div>
                <div className="admin-svc-meta">{nextDigest(data.digest.lastDigestAt)} · 09:00 Taipei</div>
              </div>
            </section>
          </div>

        </div>
      )}
    </div>
  )
}
