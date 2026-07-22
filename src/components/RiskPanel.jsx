import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'
import { useLang } from '../i18n.js'

// Kept in-file so the panel is fully self-contained (en/zh/ar).
const LABELS = {
  en: {
    title: 'Risk Register', matrix: 'Probability × Impact', register: 'Risks',
    prob: 'Probability', impact: 'Impact', owner: 'Owner', status: 'Status', action: 'Action',
    high: 'High', medium: 'Med', low: 'Low',
    impactAxis: 'Impact →', probAxis: 'Probability ↓',
    act: { mitigate: 'Mitigate now', contingency: 'Plan contingency', fallback: 'Prepare fallback', monitor: 'Monitor' },
    st: { open: 'Open', mitigating: 'Mitigating', closed: 'Closed' },
    addRisk: '+ Add risk', aiScan: '🤖 AI scan tasks', scanning: 'Scanning…',
    descPh: 'Describe the risk…', add: 'Add', cancel: 'Cancel',
    proposed: 'AI-proposed risks — review before adding', addAll: 'Add all', added: 'Added',
    noRisks: 'No risks yet. Add one manually or let AI scan your tasks.',
    ownerPh: 'owner', close: 'Close', ai: 'AI', deleteRisk: 'Delete',
  },
  zh: {
    title: '風險登記冊', matrix: '機率 × 影響', register: '風險清單',
    prob: '機率', impact: '影響', owner: '負責人', status: '狀態', action: '行動',
    high: '高', medium: '中', low: '低',
    impactAxis: '影響 →', probAxis: '機率 ↓',
    act: { mitigate: '立即處理', contingency: '制定應變', fallback: '準備備案', monitor: '定期監控' },
    st: { open: '開啟', mitigating: '處理中', closed: '已關閉' },
    addRisk: '+ 新增風險', aiScan: '🤖 AI 掃描任務', scanning: '掃描中…',
    descPh: '描述這個風險…', add: '新增', cancel: '取消',
    proposed: 'AI 提議的風險 — 加入前先審視', addAll: '全部加入', added: '已加入',
    noRisks: '尚無風險。手動新增一項，或讓 AI 掃描你的任務。',
    ownerPh: '負責人', close: '關閉', ai: 'AI', deleteRisk: '刪除',
  },
  ar: {
    title: 'سجل المخاطر', matrix: 'الاحتمال × الأثر', register: 'المخاطر',
    prob: 'الاحتمال', impact: 'الأثر', owner: 'المسؤول', status: 'الحالة', action: 'الإجراء',
    high: 'عالٍ', medium: 'متوسط', low: 'منخفض',
    impactAxis: 'الأثر →', probAxis: 'الاحتمال ↓',
    act: { mitigate: 'عالج الآن', contingency: 'خطة طوارئ', fallback: 'خطة بديلة', monitor: 'راقب' },
    st: { open: 'مفتوح', mitigating: 'قيد المعالجة', closed: 'مغلق' },
    addRisk: '+ إضافة خطر', aiScan: '🤖 فحص المهام', scanning: 'جارٍ الفحص…',
    descPh: 'صف الخطر…', add: 'إضافة', cancel: 'إلغاء',
    proposed: 'مخاطر مقترحة — راجعها قبل الإضافة', addAll: 'إضافة الكل', added: 'أُضيف',
    noRisks: 'لا مخاطر بعد. أضف واحداً يدوياً أو دع الذكاء الاصطناعي يفحص مهامك.',
    ownerPh: 'المسؤول', close: 'إغلاق', ai: 'AI', deleteRisk: 'حذف',
  },
}

// Mirror of server riskAction() — used only to colour empty matrix cells.
const RL = { high: 2, medium: 1, low: 0 }
function cellAction(p, i) {
  const P = RL[p], I = RL[i]
  if (I >= 2 && P >= 2) return 'mitigate'
  if (I >= 2) return 'fallback'
  if (P >= 2) return 'contingency'
  if (I >= 1 && P >= 1) return 'contingency'
  return 'monitor'
}

const LEVELS = ['high', 'medium', 'low']

export default function RiskPanel({ project, onClose }) {
  const { lang } = useLang()
  const L = LABELS[lang] || LABELS.en
  const [risks, setRisks] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ description: '', probability: 'medium', impact: 'medium' })
  const [proposals, setProposals] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { setRisks(await api.getRisks(project.id)) } catch {}
    setLoading(false)
  }, [project.id])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const addRisk = async () => {
    if (!draft.description.trim() || busy) return
    setBusy(true)
    try {
      const r = await api.createRisk({ projectId: project.id, ...draft, source: 'manual' })
      if (r?.id) setRisks(prev => [...prev, r])
      setDraft({ description: '', probability: 'medium', impact: 'medium' })
      setAdding(false)
    } catch {}
    setBusy(false)
  }

  const patchRisk = async (id, field, value) => {
    setRisks(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r)) // optimistic
    try {
      const updated = await api.updateRisk(id, { [field]: value })
      if (updated?.id) setRisks(prev => prev.map(r => r.id === id ? updated : r))
    } catch { load() }
  }

  const removeRisk = async (id) => {
    setRisks(prev => prev.filter(r => r.id !== id))
    try { await api.deleteRisk(id) } catch { load() }
  }

  const scan = async () => {
    setScanning(true); setProposals(null)
    try {
      const res = await api.extractRisks(project.id, lang)
      setProposals(res?.risks || [])
    } catch { setProposals([]) }
    setScanning(false)
  }

  const addProposal = async (p, idx) => {
    try {
      const r = await api.createRisk({ projectId: project.id, description: p.description, probability: p.probability, impact: p.impact, source: 'ai' })
      if (r?.id) setRisks(prev => [...prev, r])
      setProposals(prev => prev.filter((_, i) => i !== idx))
    } catch {}
  }

  const addAllProposals = async () => {
    if (!proposals?.length || busy) return
    setBusy(true)
    for (const p of proposals) {
      try {
        const r = await api.createRisk({ projectId: project.id, description: p.description, probability: p.probability, impact: p.impact, source: 'ai' })
        if (r?.id) setRisks(prev => [...prev, r])
      } catch {}
    }
    setProposals([])
    setBusy(false)
  }

  // Matrix cell counts, keyed "prob|impact"
  const cellCounts = {}
  for (const r of risks) {
    if (r.status === 'closed') continue
    const k = `${r.probability}|${r.impact}`
    cellCounts[k] = (cellCounts[k] || 0) + 1
  }

  return (
    <div className="ai-drawer risk-drawer">
      <div className="ai-drawer-header">
        <h3>⚠️ {L.title} — {project.name}</h3>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      <div className="ai-drawer-body">
        {/* Probability × Impact matrix */}
        <div className="risk-section-label">{L.matrix}</div>
        <div className="risk-matrix">
          <div className="rm-corner">{L.probAxis}<br />/ {L.impactAxis}</div>
          {['low', 'medium', 'high'].map(i => (
            <div key={`h-${i}`} className="rm-head rm-col-head">{L[i]}</div>
          ))}
          {['high', 'medium', 'low'].map(p => (
            <FragmentRow key={`row-${p}`}>
              <div className="rm-head rm-row-head">{L[p]}</div>
              {['low', 'medium', 'high'].map(i => {
                const n = cellCounts[`${p}|${i}`] || 0
                return (
                  <div key={`${p}-${i}`} className={`rm-cell act-${cellAction(p, i)} ${n ? 'has' : ''}`}
                       title={L.act[cellAction(p, i)]}>
                    {n > 0 ? n : ''}
                  </div>
                )
              })}
            </FragmentRow>
          ))}
        </div>
        <div className="risk-legend">
          {['mitigate', 'fallback', 'contingency', 'monitor'].map(a => (
            <span key={a} className="risk-legend-item"><i className={`act-${a}`} />{L.act[a]}</span>
          ))}
        </div>

        {/* Actions */}
        <div className="risk-actions">
          <button className="btn btn-sm" onClick={() => setAdding(a => !a)}>{L.addRisk}</button>
          <button className="btn btn-ai btn-sm" onClick={scan} disabled={scanning}>
            {scanning ? L.scanning : L.aiScan}
          </button>
        </div>

        {adding && (
          <div className="risk-add-form">
            <textarea rows={2} value={draft.description} placeholder={L.descPh}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
            <div className="risk-add-row">
              <label>{L.prob}
                <select value={draft.probability} onChange={e => setDraft(d => ({ ...d, probability: e.target.value }))}>
                  {LEVELS.map(v => <option key={v} value={v}>{L[v]}</option>)}
                </select>
              </label>
              <label>{L.impact}
                <select value={draft.impact} onChange={e => setDraft(d => ({ ...d, impact: e.target.value }))}>
                  {LEVELS.map(v => <option key={v} value={v}>{L[v]}</option>)}
                </select>
              </label>
              <span className={`risk-act-badge act-${cellAction(draft.probability, draft.impact)}`}>
                {L.act[cellAction(draft.probability, draft.impact)]}
              </span>
              <button className="btn btn-primary btn-sm ml-auto" onClick={addRisk} disabled={busy || !draft.description.trim()}>{L.add}</button>
            </div>
          </div>
        )}

        {proposals && proposals.length > 0 && (
          <div className="risk-proposals">
            <div className="flex items-center gap-8" style={{ marginBottom: 6 }}>
              <strong style={{ fontSize: 13 }}>{L.proposed}</strong>
              <button className="btn btn-primary btn-sm ml-auto" onClick={addAllProposals} disabled={busy}>{L.addAll}</button>
            </div>
            {proposals.map((p, i) => (
              <div key={i} className="risk-proposal-item">
                <span className={`risk-act-dot act-${cellAction(p.probability, p.impact)}`} />
                <span className="risk-prop-desc">{p.description}</span>
                <span className="risk-prop-lvl">{L[p.probability]}·{L[p.impact]}</span>
                <button className="btn btn-sm" onClick={() => addProposal(p, i)}>＋</button>
              </div>
            ))}
          </div>
        )}

        {/* Register */}
        <div className="risk-section-label" style={{ marginTop: 12 }}>{L.register} ({risks.length})</div>
        {loading ? <div className="text-muted text-sm">…</div>
          : risks.length === 0 ? <div className="text-muted text-sm risk-empty">{L.noRisks}</div>
          : (
            <div className="risk-list">
              {risks.map(r => (
                <div key={r.id} className={`risk-row ${r.status === 'closed' ? 'closed' : ''}`}>
                  <div className="risk-row-top">
                    <span className={`risk-act-badge act-${r.action}`}>{L.act[r.action]}</span>
                    <span className="risk-desc">{r.description}</span>
                    {r.source === 'ai' && <span className="risk-src">{L.ai}</span>}
                    <button className="risk-del" title={L.deleteRisk} onClick={() => removeRisk(r.id)}>×</button>
                  </div>
                  <div className="risk-row-controls">
                    <label>{L.prob}
                      <select value={r.probability} onChange={e => patchRisk(r.id, 'probability', e.target.value)}>
                        {LEVELS.map(v => <option key={v} value={v}>{L[v]}</option>)}
                      </select>
                    </label>
                    <label>{L.impact}
                      <select value={r.impact} onChange={e => patchRisk(r.id, 'impact', e.target.value)}>
                        {LEVELS.map(v => <option key={v} value={v}>{L[v]}</option>)}
                      </select>
                    </label>
                    <label>{L.status}
                      <select value={r.status} onChange={e => patchRisk(r.id, 'status', e.target.value)}>
                        {['open', 'mitigating', 'closed'].map(v => <option key={v} value={v}>{L.st[v]}</option>)}
                      </select>
                    </label>
                    <input className="risk-owner" value={r.owner} placeholder={L.ownerPh}
                      onChange={e => setRisks(prev => prev.map(x => x.id === r.id ? { ...x, owner: e.target.value } : x))}
                      onBlur={e => { if (e.target.value !== undefined) patchRisk(r.id, 'owner', e.target.value) }} />
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      <div className="ai-drawer-footer">
        <span className="ai-hint">Probability × Impact · {risks.filter(r => r.status !== 'closed').length} open</span>
        <button className="btn btn-sm" onClick={onClose}>{L.close}</button>
      </div>
    </div>
  )
}

function FragmentRow({ children }) { return <>{children}</> }
