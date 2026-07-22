import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'
import { useLang } from '../i18n.js'

// In-file labels keep the panel self-contained (en/zh/ar).
const LABELS = {
  en: {
    title: 'Flow Metrics', flow: 'Where work sits (WIP + avg dwell)',
    cycle: 'Cycle time', cycleDesc: 'Avg in-progress → done',
    rework: 'Rework (backward moves)', bottleneck: 'Bottleneck',
    wip: 'WIP', dwell: 'avg', oldest: 'oldest', close: 'Close',
    noEvents: 'Move tasks across columns to start tracking rework and cycle time.',
    noRework: 'No backward moves yet — clean flow.',
    sampled: (n) => `from ${n} completed task${n === 1 ? '' : 's'}`,
    col: { todo: 'To Do', in_progress: 'In Progress', review: 'Review', blocked: 'Blocked', done: 'Done' },
  },
  zh: {
    title: '流動指標', flow: '工作卡在哪（WIP + 平均停留）',
    cycle: '週期時間', cycleDesc: '平均 進行中 → 完成',
    rework: '返工（往回移動）', bottleneck: '瓶頸',
    wip: '在製', dwell: '平均', oldest: '最久', close: '關閉',
    noEvents: '把任務在欄位間移動，即可開始追蹤返工與週期時間。',
    noRework: '尚無往回移動 — 流動乾淨。',
    sampled: (n) => `取樣自 ${n} 個已完成任務`,
    col: { todo: '待辦', in_progress: '進行中', review: '審查', blocked: '阻塞', done: '完成' },
  },
  ar: {
    title: 'مقاييس التدفق', flow: 'أين يتراكم العمل (WIP + متوسط المكوث)',
    cycle: 'زمن الدورة', cycleDesc: 'متوسط قيد التنفيذ → منجز',
    rework: 'إعادة العمل (تحركات للخلف)', bottleneck: 'عنق الزجاجة',
    wip: 'قيد العمل', dwell: 'متوسط', oldest: 'الأقدم', close: 'إغلاق',
    noEvents: 'حرّك المهام بين الأعمدة لبدء تتبع إعادة العمل وزمن الدورة.',
    noRework: 'لا تحركات للخلف بعد — تدفق نظيف.',
    sampled: (n) => `من ${n} مهمة منجزة`,
    col: { todo: 'قائمة المهام', in_progress: 'قيد التنفيذ', review: 'مراجعة', blocked: 'محجوب', done: 'منجز' },
  },
}

// hours → compact "Xh" or "Yd"
function fmtH(h) {
  if (h == null) return '—'
  if (h < 48) return `${h}h`
  return `${(h / 24).toFixed(1)}d`
}

const FLOW_COLS = ['todo', 'in_progress', 'review', 'blocked']

export default function FlowPanel({ project, onClose }) {
  const { lang } = useLang()
  const L = LABELS[lang] || LABELS.en
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await api.getFlow(project.id)) } catch {}
    setLoading(false)
  }, [project.id])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const cols = (data?.columns || []).filter(c => FLOW_COLS.includes(c.status))
  const byStatus = Object.fromEntries((data?.columns || []).map(c => [c.status, c]))
  const reworkDetail = data?.rework?.detail || {}

  return (
    <div className="ai-drawer risk-drawer">
      <div className="ai-drawer-header">
        <h3>📊 {L.title} — {project.name}</h3>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      <div className="ai-drawer-body">
        {loading ? <div className="text-muted text-sm">…</div> : (
          <>
            <div className="risk-section-label">{L.flow}</div>
            <div className="flow-cols">
              {cols.map(c => (
                <div key={c.status} className={`flow-col col-${c.status} ${data.bottleneck === c.status ? 'bottleneck' : ''}`}>
                  <div className="flow-col-head">
                    <span className="flow-col-name">{L.col[c.status]}</span>
                    {data.bottleneck === c.status && <span className="flow-bneck">⏳ {L.bottleneck}</span>}
                  </div>
                  <div className="flow-col-stats">
                    <span className="flow-wip">{c.wip}</span>
                    <span className="flow-wip-label">{L.wip}</span>
                    <span className="flow-dwell">{L.dwell} {fmtH(c.avgDwellHours)}</span>
                  </div>
                  {c.oldest && c.wip > 0 && (
                    <div className="flow-oldest" title={c.oldest.title}>{L.oldest}: {c.oldest.title} · {fmtH(c.oldest.dwellH)}</div>
                  )}
                </div>
              ))}
            </div>

            <div className="flow-row2">
              <div className="flow-metric">
                <div className="flow-metric-val">{fmtH(data.cycleTimeHours)}</div>
                <div className="flow-metric-label">{L.cycle}</div>
                <div className="flow-metric-sub">
                  {data.completedSampled ? L.sampled(data.completedSampled) : L.cycleDesc}
                </div>
              </div>
              <div className={`flow-metric ${data.rework?.count ? 'has-rework' : ''}`}>
                <div className="flow-metric-val">{data.rework?.count ?? 0}</div>
                <div className="flow-metric-label">{L.rework}</div>
                <div className="flow-metric-sub">
                  {Object.keys(reworkDetail).length
                    ? Object.entries(reworkDetail).map(([k, n]) => `${k} ×${n}`).join(', ')
                    : L.noRework}
                </div>
              </div>
            </div>

            {data.eventCount === 0 && (
              <div className="flow-note">ℹ️ {L.noEvents}</div>
            )}
          </>
        )}
      </div>

      <div className="ai-drawer-footer">
        <span className="ai-hint">{data ? `${data.eventCount} events · cycle ${fmtH(data.cycleTimeHours)}` : '—'}</span>
        <button className="btn btn-sm" onClick={onClose}>{L.close}</button>
      </div>
    </div>
  )
}
