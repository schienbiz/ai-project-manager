import { useState, useRef, useEffect } from 'react'
import { streamAI } from '../api.js'
import { useLang } from '../i18n.js'

export default function AIPanel({ project, tasks, allProjects, allTasks, onClose, onApplyTasks, onCreateNote }) {
  const { t, lang } = useLang()
  const PRIORITY_LABEL = { low: t.priorityLow, medium: t.priorityMedium, high: t.priorityHigh, urgent: t.priorityUrgent }
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

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
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
      (err) => { setStreaming(false); setOutput(t.aiError + err) }
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
        lang,
      })
    } else if (tab === 'standup') {
      run('/pm/api/ai/standup', { project, tasks, lang })
    } else if (tab === 'risks') {
      run('/pm/api/ai/risks', { project, tasks, lang })
    } else if (tab === 'report') {
      run('/pm/api/ai/weekly-report', {
        projects: allProjects?.length ? allProjects : [project],
        tasks: allTasks?.length ? allTasks : tasks,
        lang,
      })
    } else if (tab === 'notes') {
      if (!notesText.trim()) return
      run('/pm/api/ai/parse-notes', { content: notesText, projectName: project.name, lang })
    }
  }

  const handleApply = async () => {
    if (!parsedTasks?.length) return
    setApplying(true)
    await onApplyTasks(parsedTasks)
    // Auto-save the source notes with extracted actions when parsing notes
    if (tab === 'notes' && notesText.trim() && onCreateNote) {
      await onCreateNote(notesText, parsedTasks.map(tk => tk.title))
    }
    setApplying(false)
    setParsedTasks(null)
    setOutput(prev => prev + t.appliedMsg(parsedTasks.length))
  }

  const placeholder = { plan: t.phPlan, standup: t.phStandup, risks: t.phRisks, report: t.phReport, notes: t.phNotes }

  return (
    <div className="ai-drawer">
      <div className="ai-drawer-header">
        <h3>✨ AI — {project.name}</h3>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      <div className="ai-drawer-body">
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
              rows={4}
              style={{ minHeight: 90 }}
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

        {tab === 'report' && allProjects?.length > 1 && (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {t.allProjectsReportInfo(allProjects.length)}
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
                <span className={`badge badge-${tk.priority}`}>{PRIORITY_LABEL[tk.priority] ?? tk.priority}</span>
                <span>{tk.title}</span>
                {tk.estimatedHours && <span className="text-muted text-sm ml-auto">{tk.estimatedHours}h</span>}
              </div>
            ))}
            {parsedTasks.length > 5 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{t.more(parsedTasks.length - 5)}</div>}
          </div>
        )}
      </div>

      <div className="ai-drawer-footer">
        <span className="ai-hint">{t.poweredBy}</span>
        <button className="btn btn-sm" onClick={onClose}>{t.close}</button>
      </div>
    </div>
  )
}

function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) return <strong key={i}>{p.slice(2, -2)}</strong>
    if (p.startsWith('`') && p.endsWith('`') && p.length > 2) return <code key={i} className="md-code">{p.slice(1, -1)}</code>
    return p
  })
}

export function OutputText({ text, streaming }) {
  const lines = text.split('\n')
  return (
    <div>
      {lines.map((line, i) => {
        const isLast = i === lines.length - 1
        const cursor = isLast && streaming ? <span className="ai-streaming"> ▌</span> : null

        if (line.startsWith('### ')) return <h5 key={i} className="md-h3">{renderInline(line.slice(4))}{cursor}</h5>
        if (line.startsWith('## ')) return <h4 key={i} className="md-h2">{renderInline(line.slice(3))}{cursor}</h4>
        if (line.startsWith('# ')) return <h3 key={i} className="md-h1">{renderInline(line.slice(2))}{cursor}</h3>
        if (/^[-*] /.test(line)) return (
          <div key={i} className="md-li">
            <span className="md-bullet">•</span>
            <span>{renderInline(line.slice(2))}{cursor}</span>
          </div>
        )
        if (/^\d+\. /.test(line)) return (
          <div key={i} className="md-li">
            <span className="md-bullet">{line.match(/^\d+/)[0]}.</span>
            <span>{renderInline(line.replace(/^\d+\. /, ''))}{cursor}</span>
          </div>
        )
        if (!line.trim()) return <div key={i} className="md-gap" />
        return <div key={i} className="md-p">{renderInline(line)}{cursor}</div>
      })}
    </div>
  )
}
