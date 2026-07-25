import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { useLang, catLabel } from '../i18n.js'

const domainMeta = (t) => ({
  life:     t.domainLife,
  business: t.domainBusiness,
  null:     t.domainNone,
})

export default function Portfolio({ projects = [], onSelectProject }) {
  const { t } = useLang()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    api.getPortfolio()
      .then(d => { if (alive) { setData(d); setLoading(false) } })
      .catch(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  if (loading) return <div style={{ padding: 24, color: 'var(--muted)' }}>{t.loading}</div>

  const domains = data?.domains || []
  const unclassified = projects.filter(p => !p.domain)

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1000, margin: '0 auto', width: '100%' }}>
      <h2 style={{ margin: 0 }}>{t.portfolioTitle}</h2>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>{t.portfolioSub}</p>

      {unclassified.length > 0 && (
        <div style={{ border: '1px solid var(--warning, #f59e0b)', background: 'rgba(245,158,11,.08)', borderRadius: 10, padding: '10px 14px', margin: '14px 0' }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>⚠ {t.pfUnclassified(unclassified.length)}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {unclassified.slice(0, 12).map(p => (
              <button key={p.id} className="btn btn-sm" style={{ fontSize: 12 }} onClick={() => onSelectProject(p.id)}>{p.name}</button>
            ))}
          </div>
        </div>
      )}

      {domains.length === 0
        ? <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 16 }}>{t.pfEmptyHint}</div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginTop: 16 }}>
            {domains.map(d => <DomainCard key={String(d.domain)} d={d} t={t} />)}
          </div>
        )}
    </div>
  )
}

function DomainCard({ d, t }) {
  const label = domainMeta(t)[String(d.domain)] || t.domainNone
  const stalled = d.activeProjects > 0 && d.inProgress === 0 && d.blocked === 0
  const noWork = d.totalProjects > 0 && d.activeProjects === 0
  const cats = d.categories.filter(c => c.totalProjects > 0 || c.pendingDecisions > 0)

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <div className="flex items-center" style={{ gap: 8, marginBottom: 12 }}>
        <strong style={{ fontSize: 15 }}>{label}</strong>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>{d.activeProjects}/{d.totalProjects} {t.pfProjects}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
        <Metric v={d.inProgress} label={t.pfInProg} />
        <Metric v={d.blocked} label={t.blocked} danger={d.blocked > 0} />
        <Metric v={d.overdue} label={t.overdue} danger={d.overdue > 0} />
        <Metric v={d.pendingDecisions} label={t.pfPending} warn={d.pendingDecisions > 0} />
      </div>

      {(noWork || stalled) && (
        <div style={{ fontSize: 11, color: 'var(--warning, #f59e0b)', marginBottom: 8 }}>
          ⚠ {noWork ? t.pfNoWork : t.pfStalled}
        </div>
      )}

      {cats.map((c, i) => (
        <div key={i} className="flex items-center" style={{ gap: 8, fontSize: 12, padding: '5px 0', borderTop: i ? '1px solid var(--border)' : '1px solid var(--border)' }}>
          <span>{c.category ? catLabel(t, c.category) : t.pfOther}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
            {c.activeProjects}/{c.totalProjects}
            {c.inProgress > 0 && ` · ${c.inProgress} ${t.pfInProg}`}
            {c.blocked > 0 && ` · ⚠${c.blocked}`}
            {c.overdue > 0 && ` · 🔴${c.overdue}`}
            {c.pendingDecisions > 0 && ` · 🧭${c.pendingDecisions}`}
          </span>
        </div>
      ))}
    </div>
  )
}

function Metric({ v, label, danger, warn }) {
  const color = danger ? 'var(--danger, #ef4444)' : warn ? 'var(--warning, #f59e0b)' : 'var(--fg, #111)'
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: v > 0 ? color : 'var(--muted)' }}>{v}</div>
      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{label}</div>
    </div>
  )
}
