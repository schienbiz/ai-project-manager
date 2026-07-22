import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'
import { useLang } from '../i18n.js'

// In-file labels keep the panel self-contained (en/zh/ar).
const LABELS = {
  en: {
    title: 'Critical Path', criticalPath: 'Critical path (longest chain by hours)',
    total: 'Total', warnings: 'Checks', noPath: 'Add dependencies between tasks to see the critical path.',
    allClear: 'No scheduling issues found.', close: 'Close', hours: 'h',
    w: {
      undecomposed: 'Under-decomposed',
      'dangling-dep': 'Broken dependency',
      cycle: 'Dependency cycle',
    },
    cycleNote: 'Critical path unavailable until the cycle is resolved.',
  },
  zh: {
    title: '關鍵路徑', criticalPath: '關鍵路徑（工時最長的相依鏈）',
    total: '總計', warnings: '檢查', noPath: '在任務間設定相依關係，即可看出關鍵路徑。',
    allClear: '未發現排程問題。', close: '關閉', hours: 'h',
    w: {
      undecomposed: '拆解不夠細',
      'dangling-dep': '相依已失效',
      cycle: '相依循環',
    },
    cycleNote: '循環解決前無法計算關鍵路徑。',
  },
  ar: {
    title: 'المسار الحرج', criticalPath: 'المسار الحرج (أطول سلسلة بالساعات)',
    total: 'الإجمالي', warnings: 'الفحوصات', noPath: 'أضف اعتماديات بين المهام لرؤية المسار الحرج.',
    allClear: 'لا توجد مشكلات جدولة.', close: 'إغلاق', hours: 'س',
    w: {
      undecomposed: 'غير مُجزّأ بما يكفي',
      'dangling-dep': 'اعتمادية معطوبة',
      cycle: 'حلقة اعتمادية',
    },
    cycleNote: 'المسار الحرج غير متاح حتى تُحل الحلقة.',
  },
}

const WARN_ICON = { undecomposed: '✂️', 'dangling-dep': '🔗', cycle: '🔄' }

export default function SchedulePanel({ project, onClose }) {
  const { lang } = useLang()
  const L = LABELS[lang] || LABELS.en
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await api.getSchedule(project.id)) } catch {}
    setLoading(false)
  }, [project.id])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const cp = data?.criticalPath || []
  const warnings = data?.warnings || []

  return (
    <div className="ai-drawer risk-drawer">
      <div className="ai-drawer-header">
        <h3>🧭 {L.title} — {project.name}</h3>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      <div className="ai-drawer-body">
        {loading ? <div className="text-muted text-sm">…</div> : (
          <>
            <div className="risk-section-label">{L.criticalPath}</div>
            {data?.hasCycle ? (
              <div className="sched-empty">{L.cycleNote}</div>
            ) : cp.length <= 1 ? (
              <div className="sched-empty">{L.noPath}</div>
            ) : (
              <>
                <div className="sched-path">
                  {cp.map((t, i) => (
                    <div key={t.id} className="sched-node">
                      <span className="sched-num">{i + 1}</span>
                      <span className="sched-title">{t.title}</span>
                      <span className="sched-hours">{t.estimatedHours}{L.hours}</span>
                    </div>
                  ))}
                </div>
                <div className="sched-total">{L.total}: <strong>{data.totalHours}{L.hours}</strong></div>
              </>
            )}

            <div className="risk-section-label" style={{ marginTop: 14 }}>{L.warnings} ({warnings.length})</div>
            {warnings.length === 0 ? (
              <div className="sched-clear">✓ {L.allClear}</div>
            ) : (
              <div className="sched-warns">
                {warnings.map((w, i) => (
                  <div key={i} className={`sched-warn warn-${w.type}`}>
                    <span className="sched-warn-icon">{WARN_ICON[w.type] || '⚠️'}</span>
                    <div className="sched-warn-body">
                      <div className="sched-warn-type">{L.w[w.type] || w.type}{w.title ? ` — ${w.title}` : ''}</div>
                      <div className="sched-warn-detail">{w.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="ai-drawer-footer">
        <span className="ai-hint">Critical path · {cp.length ? `${data.totalHours}${L.hours}` : '—'}</span>
        <button className="btn btn-sm" onClick={onClose}>{L.close}</button>
      </div>
    </div>
  )
}
