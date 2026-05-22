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

export default function AdminDashboard({ onBack }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [restarting, setRestarting] = useState({})
  const [error, setError]     = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const d = await api.getAdminStatus()
      setData(d)
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
      </div>

      {loading && <div className="admin-loading">Checking services…</div>}
      {error   && <div className="admin-error">⚠️ {error}</div>}

      {data && (
        <div className="admin-body">

          {/* Services */}
          <section className="admin-section">
            <div className="admin-section-title">Services</div>
            <div className="admin-service-grid">
              {data.services.map(svc => (
                <div key={svc.label} className={`admin-service-card ${svc.healthy ? 'healthy' : 'unhealthy'}`}>
                  <div className="admin-svc-left">
                    <span className={`admin-dot ${svc.healthy ? 'dot-ok' : 'dot-err'}`} />
                    <div>
                      <div className="admin-svc-name">{svc.name}</div>
                      <div className="admin-svc-meta">
                        :{svc.port} · {svc.status || 'no response'} · {svc.latency}ms
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

              {/* ATung Syncthing — monitored locally by ATung watchdog, not reachable from chusMBp */}
              <div className="admin-service-card" style={{ borderLeft: '3px solid #58a6ff', opacity: .8 }}>
                <div className="admin-svc-left">
                  <span className="admin-dot" style={{ background: '#58a6ff' }} />
                  <div>
                    <div className="admin-svc-name">ATung Syncthing</div>
                    <div className="admin-svc-meta">monitored by ATung watchdog · Telegram alerts on failure</div>
                  </div>
                </div>
                <span className="admin-svc-meta" style={{ paddingRight: 8 }}>ATung</span>
              </div>
            </div>
          </section>

          {/* AI Providers */}
          <section className="admin-section">
            <div className="admin-section-title">AI Providers</div>
            <div className="admin-provider-grid">
              {data.providers.map(p => (
                <div key={p.name} className={`admin-provider-card ${p.coolingDown ? 'cooling' : 'ready'}`}>
                  <span className={`admin-dot ${p.coolingDown ? 'dot-warn' : 'dot-ok'}`} />
                  <div>
                    <div className="admin-svc-name">{p.name}</div>
                    <div className="admin-svc-meta">
                      {p.model}
                      {p.coolingDown && <span className="admin-cooldown"> · 🔴 cooling until {new Date(p.cooldownUntil).toLocaleTimeString()}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
