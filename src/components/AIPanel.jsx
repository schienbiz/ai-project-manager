import { useState, useRef } from 'react'
import { streamAI } from '../api.js'

const TABS = [
  { key: 'plan',    label: '📋 Generate Plan' },
  { key: 'standup', label: '📣 Standup' },
  { key: 'risks',   label: '⚠️ Risks' },
  { key: 'report',  label: '📊 Weekly Report' },
  { key: 'notes',   label: '📝 Parse Notes' },
]

export default function AIPanel({ project, tasks, onClose, onApplyTasks }) {
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
        // Try to parse JSON for plan/notes tabs
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
    setOutput(prev => prev + '\n\n✅ Applied ' + parsedTasks.length + ' tasks to the board.')
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ height: '80vh' }}>
        <div className="modal-header">
          <h3>✨ AI Assistant — {project.name}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 0 }}>
          {/* Tabs */}
          <div className="ai-tabs">
            {TABS.map(t => (
              <button
                key={t.key}
                className={`ai-tab ${tab === t.key ? 'active' : ''}`}
                onClick={() => { setTab(t.key); setOutput(''); setParsedTasks(null) }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab-specific inputs */}
          {tab === 'plan' && (
            <div className="form-row">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Team Size</label>
                <input value={planOpts.teamSize} onChange={e => setPlanOpts(o => ({ ...o, teamSize: e.target.value }))} placeholder="e.g. 3 engineers" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Due Date</label>
                <input type="date" value={planOpts.dueDate} onChange={e => setPlanOpts(o => ({ ...o, dueDate: e.target.value }))} />
              </div>
            </div>
          )}

          {tab === 'notes' && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Paste Meeting Notes</label>
              <textarea
                value={notesText}
                onChange={e => setNotesText(e.target.value)}
                placeholder="Paste your meeting notes here. AI will extract all action items as tasks."
                rows={5}
                style={{ minHeight: 100 }}
              />
            </div>
          )}

          {tab === 'standup' && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Generates a standup based on current task status ({tasks.filter(t => t.status === 'done').length} done, {tasks.filter(t => t.status === 'in_progress').length} in progress, {tasks.filter(t => t.status === 'blocked').length} blocked).
            </div>
          )}

          {tab === 'risks' && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Analyzes {tasks.filter(t => t.status === 'blocked').length} blocked and {tasks.filter(t => {
                const today = new Date().toISOString().split('T')[0]
                return t.dueDate && t.dueDate < today && t.status !== 'done'
              }).length} overdue tasks to identify risks.
            </div>
          )}

          {/* Run button */}
          <button className="btn btn-ai" onClick={handleRun} disabled={streaming}>
            {streaming ? '⏳ Thinking…' : '▶ Run'}
          </button>

          {/* Output */}
          <div className={`ai-output ${!output ? 'empty' : ''}`} style={{ flex: 1, minHeight: 120 }}>
            {!output && !streaming
              ? getPlaceholder(tab)
              : <OutputText text={output} streaming={streaming} />
            }
          </div>

          {/* Parsed tasks preview */}
          {parsedTasks && (
            <div className="task-preview">
              <div className="flex items-center gap-8" style={{ marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>✅ {parsedTasks.length} tasks ready to apply</strong>
                <button className="btn btn-primary btn-sm ml-auto" onClick={handleApply} disabled={applying}>
                  {applying ? 'Applying…' : 'Apply to Board'}
                </button>
              </div>
              {parsedTasks.slice(0, 5).map((t, i) => (
                <div key={i} className="task-preview-item">
                  <span className={`badge badge-${t.priority}`}>{t.priority}</span>
                  <span>{t.title}</span>
                  {t.estimatedHours && <span className="text-muted text-sm ml-auto">{t.estimatedHours}h</span>}
                </div>
              ))}
              {parsedTasks.length > 5 && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>+{parsedTasks.length - 5} more</div>}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <span className="ai-hint">Powered by Groq · Cerebras · NVIDIA · OpenRouter</span>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function OutputText({ text, streaming }) {
  // Render **bold** markdown simply
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

function getPlaceholder(tab) {
  const hints = {
    plan:    'AI will generate a full task breakdown for this project. Adjust team size and due date for better results.',
    standup: 'AI will write a daily standup based on your current task status.',
    risks:   'AI will analyze your blocked and overdue tasks to surface risks and recommend actions.',
    report:  'AI will generate a professional weekly status report for this project.',
    notes:   'Paste meeting notes above and AI will extract all action items as tasks.',
  }
  return hints[tab] || 'Run AI to generate output.'
}
