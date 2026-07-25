import { useState, useEffect, useCallback } from 'react'
import { api, streamAI } from '../api.js'
import { useLang, DOMAIN_CATEGORIES, catLabel } from '../i18n.js'
import { OutputText } from './AIPanel.jsx'

const REVIEW_DUE_DAYS = 7
const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / 86400000

const OUTCOME_BADGE = (t) => ({
  good:  { cls: 'badge-low',    label: t.outcomeGood },
  bad:   { cls: 'badge-urgent', label: t.outcomeBad },
  mixed: { cls: 'badge-medium', label: t.outcomeMixed },
})

export default function DecisionLog({ projects = [] }) {
  const { t, lang } = useLang()
  const [decisions, setDecisions] = useState([])
  const [calib, setCalib] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fDomain, setFDomain] = useState('')
  const [fOutcome, setFOutcome] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const q = {}
    if (fDomain) q.domain = fDomain
    if (fOutcome) q.outcome = fOutcome
    try {
      const [d, c] = await Promise.all([api.getDecisions(q), api.getCalibration(fDomain)])
      setDecisions(Array.isArray(d) ? d : [])
      setCalib(c)
    } catch { setDecisions([]) }
    setLoading(false)
  }, [fDomain, fOutcome])

  useEffect(() => { load() }, [load])

  const projName = (id) => projects.find(p => p.id === id)?.name

  const outcomeFilters = [
    ['', t.filterAll], ['pending', t.outcomePending],
    ['good', t.outcomeGoodShort], ['bad', t.outcomeBadShort], ['mixed', t.outcomeMixedShort],
  ]

  return (
    <div className="decision-log" style={{ padding: '24px 28px', maxWidth: 980, margin: '0 auto', width: '100%' }}>
      <div className="flex items-center" style={{ gap: 12, marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>{t.decisionLogTitle}</h2>
        <button className="btn btn-primary btn-sm ml-auto" onClick={() => setCreating(c => !c)}>
          {t.newDecision}
        </button>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>{t.decisionLogSub}</p>

      {calib && <Calibration calib={calib} t={t} />}

      {creating && <NewDecision t={t} lang={lang} onDone={load} onClose={() => setCreating(false)} />}

      {/* Filters */}
      <div className="flex items-center" style={{ gap: 8, flexWrap: 'wrap', margin: '16px 0 12px' }}>
        <FilterChips value={fDomain} onChange={setFDomain}
          options={[['', t.filterAll], ['life', t.domainLife], ['business', t.domainBusiness]]} />
        <span style={{ color: 'var(--border)', margin: '0 4px' }}>|</span>
        <FilterChips value={fOutcome} onChange={setFOutcome} options={outcomeFilters} />
      </div>

      {loading ? <div style={{ color: 'var(--muted)', padding: 20 }}>{t.loading}</div>
        : decisions.length === 0
          ? <div style={{ color: 'var(--muted)', padding: 20, fontSize: 13 }}>{t.decisionLogEmpty}</div>
          : decisions.map(d => (
              <DecisionCard key={d.id} d={d} t={t} projName={projName} onChanged={load} />
            ))}
    </div>
  )
}

function FilterChips({ value, onChange, options }) {
  return options.map(([val, label]) => (
    <button key={val} onClick={() => onChange(val)}
      className={`btn btn-sm${value === val ? ' btn-primary' : ''}`}
      style={{ fontSize: 12 }}>{label}</button>
  ))
}

function Calibration({ calib, t }) {
  const rev = calib.byReversibility || {}
  const row = (key, label) => {
    const b = rev[key]
    if (!b || !b.n) return null
    const pct = Math.round((b.good / b.n) * 100)
    return (
      <div key={key} className="flex items-center" style={{ gap: 8, fontSize: 12 }}>
        <span style={{ width: 130, color: 'var(--muted)' }}>{label}</span>
        <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent, #6366f1)' }} />
        </div>
        <span style={{ width: 70, textAlign: 'right' }}>{pct}% · {b.n}</span>
      </div>
    )
  }
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px', marginTop: 14, background: 'var(--surface, #fafafa)' }}>
      <div className="flex items-center" style={{ gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>{t.calibrationTitle}</strong>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t.reviewedCount(calib.reviewed)}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
        {row('one-way', t.axisReversibility + ' · one-way')}
        {row('reversible', t.axisReversibility + ' · reversible')}
      </div>
      {calib.insight && <div style={{ fontSize: 12.5, color: 'var(--fg, #333)' }}>{calib.insight}</div>}
    </div>
  )
}

function NewDecision({ t, lang, onDone, onClose }) {
  const [kind, setKind] = useState('decide')
  const [domain, setDomain] = useState('')
  const [category, setCategory] = useState('')
  const [text, setText] = useState('')
  const [output, setOutput] = useState('')
  const [streaming, setStreaming] = useState(false)

  const run = () => {
    if (!text.trim() || streaming) return
    setOutput(''); setStreaming(true)
    const endpoint = kind === 'decide' ? '/pm/api/ai/decide' : '/pm/api/ai/frame'
    const body = kind === 'decide'
      ? { decision: text, context: '', lang, domain, category }
      : { request: text, context: '', lang, domain, category }
    let full = ''
    streamAI(endpoint, body,
      (chunk) => { full += chunk; setOutput(full) },
      () => { setStreaming(false); onDone?.() },
      (err) => { setStreaming(false); setOutput('⚠️ ' + err) })
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginTop: 14 }}>
      <div className="flex items-center" style={{ gap: 8, marginBottom: 10 }}>
        <button className={`btn btn-sm${kind === 'decide' ? ' btn-primary' : ''}`} onClick={() => setKind('decide')}>🧭 {t.kindDecide}</button>
        <button className={`btn btn-sm${kind === 'frame' ? ' btn-primary' : ''}`} onClick={() => setKind('frame')}>🎯 {t.kindFrame}</button>
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>{t.standaloneDecisionHint}</span>
        <button className="close-btn ml-auto" onClick={onClose}>×</button>
      </div>
      <div className="form-row">
        <div className="form-group" style={{ marginBottom: 8 }}>
          <label>{t.domainLabel}</label>
          <select value={domain} onChange={e => { setDomain(e.target.value); setCategory('') }}>
            <option value="">{t.domainNone}</option>
            <option value="life">{t.domainLife}</option>
            <option value="business">{t.domainBusiness}</option>
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 8 }}>
          <label>{t.categoryLabel}</label>
          <select value={category} onChange={e => setCategory(e.target.value)} disabled={!domain}>
            <option value="">{t.categoryNone}</option>
            {(DOMAIN_CATEGORIES[domain] || []).map(c => <option key={c} value={c}>{catLabel(t, c)}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group" style={{ marginBottom: 8 }}>
        <label>{kind === 'decide' ? t.decideInputLabel : t.frameInputLabel}</label>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
          placeholder={kind === 'decide' ? t.decidePlaceholder : t.framePlaceholder} style={{ minHeight: 70 }} />
      </div>
      <button className="btn btn-ai" onClick={run} disabled={streaming}>{streaming ? t.thinking : t.run}</button>
      {output && <div className="ai-output" style={{ marginTop: 10 }}><OutputText text={output} streaming={streaming} /></div>}
    </div>
  )
}

function DecisionCard({ d, t, projName, onChanged }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState(d.outcomeNote || '')
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  const ob = OUTCOME_BADGE(t)[d.outcome]
  const reviewDue = !d.outcome && daysSince(d.createdAt) >= REVIEW_DUE_DAYS
  const domLabel = d.domain === 'life' ? t.domainLife : d.domain === 'business' ? t.domainBusiness : null
  const pName = d.projectId && projName(d.projectId)

  const save = async (outcome) => {
    setSaving(true)
    try { await api.setDecisionOutcome(d.id, { outcome, outcomeNote: note }); onChanged?.() }
    finally { setSaving(false); setEditing(false) }
  }
  const del = async () => { await api.deleteDecision(d.id); onChanged?.() }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 10,
                  borderLeft: reviewDue ? '3px solid var(--warning, #f59e0b)' : undefined }}>
      <div className="flex items-center" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="badge" style={{ background: 'var(--border)', fontSize: 11 }}>
          {d.kind === 'frame' ? '🎯 ' + t.kindFrame : '🧭 ' + t.kindDecide}
        </span>
        {domLabel && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{domLabel}{d.category ? ' · ' + catLabel(t, d.category) : ''}</span>}
        {pName && <span style={{ fontSize: 11, color: 'var(--muted)' }}>· {pName}</span>}
        {ob ? <span className={`badge ${ob.cls}`} style={{ fontSize: 11 }}>{ob.label}</span>
            : <span className="badge" style={{ fontSize: 11, background: 'var(--border)' }}>{t.outcomePending}</span>}
        {reviewDue && <span style={{ fontSize: 11, color: 'var(--warning, #f59e0b)', fontWeight: 600 }}>⚠ {t.reviewNeeded}</span>}
        <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
          {new Date(d.createdAt).toLocaleDateString()}
        </span>
      </div>

      <div style={{ fontWeight: 600, fontSize: 14, margin: '8px 0 4px', cursor: 'pointer' }} onClick={() => setExpanded(e => !e)}>
        {d.title || d.input}
      </div>

      {d.kind === 'decide' && (d.impact || d.reversibility || d.urgency) && (
        <div className="flex items-center" style={{ gap: 6, fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>
          {d.impact && <span>{t.axisImpact}: {d.impact}</span>}
          {d.reversibility && <span>· {t.axisReversibility}: {d.reversibility}</span>}
          {d.urgency && <span>· {t.axisUrgency}: {d.urgency}</span>}
        </div>
      )}

      {d.verdict && <div style={{ fontSize: 13, marginBottom: 4 }}>{d.verdict}</div>}

      {expanded && (
        <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          {Array.isArray(d.assumptions) && d.assumptions.length > 0 && (
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              <strong>{t.assumptionsLabel}:</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {d.assumptions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
          {d.analysisMd && <div className="ai-output" style={{ fontSize: 12.5 }}><OutputText text={d.analysisMd} streaming={false} /></div>}
          {d.outcomeNote && !editing && (
            <div style={{ fontSize: 12.5, marginTop: 8, padding: 8, background: 'var(--surface, #fafafa)', borderRadius: 6 }}>
              <strong>{t.recordOutcome}:</strong> {d.outcomeNote}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center" style={{ gap: 6, marginTop: 8 }}>
        <button className="btn btn-sm" onClick={() => setExpanded(e => !e)} style={{ fontSize: 12 }}>
          {expanded ? '▲' : '▼'}
        </button>
        <button className="btn btn-sm" onClick={() => setEditing(e => !e)} style={{ fontSize: 12 }}>{t.recordOutcome}</button>
        {confirmDel
          ? <><span style={{ fontSize: 11, color: 'var(--danger, #ef4444)' }}>{t.deleteDecisionConfirm}</span>
              <button className="btn btn-sm" style={{ fontSize: 12, color: 'var(--danger, #ef4444)' }} onClick={del}>✓</button>
              <button className="btn btn-sm" style={{ fontSize: 12 }} onClick={() => setConfirmDel(false)}>×</button></>
          : <button className="btn btn-sm ml-auto" style={{ fontSize: 12, color: 'var(--muted)' }} onClick={() => setConfirmDel(true)}>🗑</button>}
      </div>

      {editing && (
        <div style={{ marginTop: 8 }}>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder={t.outcomeNoteLabel} style={{ width: '100%', fontSize: 12.5 }} />
          <div className="flex items-center" style={{ gap: 6, marginTop: 6 }}>
            <button className="btn btn-sm" style={{ fontSize: 12 }} disabled={saving} onClick={() => save('good')}>{t.outcomeGood}</button>
            <button className="btn btn-sm" style={{ fontSize: 12 }} disabled={saving} onClick={() => save('mixed')}>{t.outcomeMixed}</button>
            <button className="btn btn-sm" style={{ fontSize: 12 }} disabled={saving} onClick={() => save('bad')}>{t.outcomeBad}</button>
            {d.outcome && <button className="btn btn-sm ml-auto" style={{ fontSize: 12, color: 'var(--muted)' }} disabled={saving} onClick={() => save(null)}>{t.clearOutcome}</button>}
          </div>
        </div>
      )}
    </div>
  )
}
