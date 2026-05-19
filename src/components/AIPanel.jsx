import { useState, useRef } from 'react'
import { streamAI } from '../api.js'
import { useLang } from '../i18n.js'

export default function AIPanel({ project, tasks, onClose, onApplyTasks }) {
  const { t } = useLang()
  const TABS = [
    { key: 'plan',    label: t.tabPlan },
    { key: 'standup', label: t.tabStandup },
    { key: 'risks',   label: t.tabRisks },
    { key: 'report',  label: t.tabReport },
    { key: 'notes',   label: t.tabNotes },
  ]

  const [tab, setTab] = useState('plan')
  const [output, setOutput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [parsedTasks, setParsedTasks] = useState(null)
  const [applying, setApplying] = useState(false)
  const [planOpts, setPlanOpts] = useState({ teamSize: '', dueDate: project.dueDate || '' })
  const [notesText, setNotesText] = useState('')
  const abortRef = useRef(false)

  const run = async (endpoint, body) => {
    setOutput('')
    setParsedTasks(null)
    setStreaming(true)
    abortRef.current = false
    let full = ''

    await streamAI(
      endpoint,
      body,
      (chunk) => {
        if (abortRef.current) return
        full += chunk
        setOutput(full)
      },
      () => {
        setStreaming(false)
        if (tab === 'plan' || tab === 'notes') {
          try {
            const match = full.match(/\[[\s\S]*\]/)
            if (match) {
              const arr = JSON.parse(match[0])
              if (Array.isArray(arr) && arr.length) setParsedTasks(arr)
            }
          } catch {}
        }
      },
      (err) => { setStreaming(false); setOutput('Error: ' + err) }
    )
  }

  const handleRun = () => {
    if (tab === 'plan') {
      run('/pm/api/ai/generate-plan', {
        projectName: project.name,
        description: project.description,
        goal: project.goal,
        dueDate: planOpts.dueDate,
        teamSize: planOpts.teamSize,
      })
    } else if (tab === 'standup') {
      run('/pm/api/ai/standup', { project, tasks })
    } else if (tab === 'risks') {
      run('/pm/api/ai/risks', { project, tasks })
    } else if (tab === 'report') {
      run('/pm/api/ai/weekly-report', { projects: [project], tasks })
    } else if (tab === 'notes') {
      if (!notesText.trim()) return
      run('/pm/api/ai/parse-notes', { content: notesText, projectName: project.name })
    }
  }

  const handleApply = async () => {
    if (!parsedTasks?.length) return
    setApplying(true)
    await onApplyTasks(parsedTasks)
    setApplying(false)
    setParsedTasks(null)
    setOutput(prev => prev + t.appliedMsg(parsedTasks.length))
  }

  const placeholder = { plan: t.phPlan, standup: t.phStandup, risks: t.phRisks, report: t.phReport, notes: t.phNotes }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ height: '80vh' }}>
        <div className="modal-header">
          <h3>{t.aiPanelTitle(project.name)}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 0 }}>
          <div className="ai-tabs">
            {TABS.map(tb => (
              <button
                key={tb.key}
                className={`ai-tab ${tab === tb.key ? 'active' : ''}`}
                onClick={() => { setTab(tb.key); setOutput(''); setParsedTasks(null) }}
              >
                {tb.label}
              </button>
            ))}
          </div>

          {tab === 'plan' && (
            <div className="form-row">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>{t.teamSizeLabel}</label>
                <input value={planOpts.teamSize} onChange={e => setPlanOpts(o => ({ ...o, teamSize: e.target.value }))} placeholder={t.teamSizePlaceholder} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>{t.dueDateLabel2}</label>
                <input type="date" value={planOpts.dueDate} onChange={e => setPlanOpts(o => ({ ...o, dueDate: e.target.value }))} />
              </div>
            </div>
          )}

          {tab === 'notes' && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>{t.pasteNotesLabel}</label>
              <textarea
                value={notesText}
                onChange={e => setNotesText(e.target.value)}
                placeholder={t.notesPastePlaceholder}
                rows={5}
                style={{ minHeight: 100 }}
              />
            </div>
          )}

          {tab === 'standup' && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t.standupInfo(
                tasks.filter(t2 => t2.status === 'done').length,
                tasks.filter(t2 => t2.status === 'in_progress').length,
                tasks.filter(t2 => t2.status === 'blocked').length
              )}
            </div>
          )}

          {tab === 'risks' && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t.risksInfo(
                tasks.filter(t2 => t2.status === 'blocked').length,
                tasks.filter(t2 => {
                  const today = new Date().toISOString().split('T')[0]
                  return t2.dueDate && t2.dueDate < today && t2.status !== 'done'
                }).length
              )}
            </div>
          )}

          <button className="btn btn-ai" onClick={handleRun} disabled={streaming}>
            {streaming ? t.thinking : t.run}
          </button>

          <div className={`ai-output ${!output ? 'empty' : ''}`} style={{ flex: 1, minHeight: 120 }}>
            {!output && !streaming
              ? placeholder[tab]
              : <OutputText text={output} streaming={streaming} />
            }
          </div>

          {parsedTasks && (
            <div className="task-preview">
              <div className="flex items-center gap-8" style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>{t.tasksReady(parsedTasks.length)}</strong>
                <button className="btn btn-primary btn-sm ml-auto" onClick={handleApply} disabled={applying}>
                  {applying ? t.applying : t.applyToBoard}
                </button>
              </div>
              {parsedTasks.slice(0, 5).map((tk, i) => (
                <div key={i} className="task-preview-item">
                  <span className={`badge badge-${tk.priority}`}>{tk.priority}</span>
                  <span>{tk.title}</span>
                  {tk.estimatedHours && <span className="text-muted text-sm ml-auto">{tk.estimatedHours}h</span>}
                </div>
              ))}
              {parsedTasks.length > 5 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{t.more(parsedTasks.length - 5)}</div>}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <span className="ai-hint">{t.poweredBy}</span>
          <button className="btn" onClick={onClose}>{t.close}</button>
        </div>
      </div>
    </div>
  )
}

function OutputText({ text, streaming }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i}>{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
      {streaming && <span className="ai-streaming"> ▌</span>}
    </span>
  )
}
