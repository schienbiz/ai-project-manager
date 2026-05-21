import { useState, useRef } from 'react'
import { streamAgent } from '../api.js'
import { OutputText } from './AIPanel.jsx'
import { useLang } from '../i18n.js'

const AGENT_TYPES = [
  { key: 'auto',     emoji: '🤖', label: 'Auto' },
  { key: 'research', emoji: '🔍', label: 'Research' },
  { key: 'write',    emoji: '✍️', label: 'Write' },
  { key: 'plan',     emoji: '🗺️', label: 'Plan' },
]

export default function AgentPanel({ task, project, onClose, onApprove }) {
  const { t, lang } = useLang()
  const [agentType, setAgentType] = useState('auto')
  const [steps, setSteps] = useState([])
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const abortRef = useRef(false)
  const stepsRef = useRef(null)

  const run = () => {
    setSteps([])
    setOutput('')
    setRunning(true)
    setDone(false)
    abortRef.current = false
    let full = ''

    streamAgent(
      '/pm/api/ai/agent-run',
      { taskId: task.id, projectId: project.id, agentType, lang },
      (step) => {
        if (abortRef.current) return
        setSteps(s => {
          const next = [...s, step]
          setTimeout(() => stepsRef.current?.scrollTo(0, 99999), 10)
          return next
        })
      },
      (chunk) => {
        if (abortRef.current) return
        full += chunk
        setOutput(full)
      },
      () => { setRunning(false); setDone(true) },
      (err) => { setRunning(false); setSteps(s => [...s, `❌ ${err}`]) }
    )
  }

  const approve = (action) => {
    onApprove(task.id, output, action)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ height: '85vh' }}>
        <div className="modal-header">
          <h3>
            🤖 {t.agentTitle}
            <span style={{ fontWeight: 400, fontSize: 13, marginInlineStart: 8, color: 'var(--muted)' }}>
              {task.title}
            </span>
          </h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 0 }}>
          {/* Agent type selector */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {AGENT_TYPES.map(a => (
              <button
                key={a.key}
                className={`btn btn-sm${agentType === a.key ? ' btn-primary' : ''}`}
                onClick={() => setAgentType(a.key)}
                disabled={running}
                style={{ gap: 4 }}
              >
                {a.emoji} {a.label}
              </button>
            ))}
          </div>

          <button className="btn btn-ai" onClick={run} disabled={running}>
            {running ? t.agentRunning : done ? t.agentRerun : t.agentRun}
          </button>

          {/* Agent step log */}
          {steps.length > 0 && (
            <div className="agent-steps" ref={stepsRef}>
              {steps.map((s, i) => <div key={i} className="agent-step">{s}</div>)}
              {running && <div className="agent-step agent-thinking">…</div>}
            </div>
          )}

          {/* Output */}
          <div className="ai-output" style={{ flex: 1, minHeight: 100 }}>
            {!output && !running
              ? <span style={{ color: 'var(--muted)' }}>{t.agentPlaceholder}</span>
              : <OutputText text={output} streaming={running} />
            }
          </div>
        </div>

        <div className="modal-footer" style={{ gap: 8 }}>
          {done && output && (
            <>
              <button className="btn btn-primary" onClick={() => approve('approved')}>
                {t.agentApprove}
              </button>
              <button className="btn" onClick={() => approve('saved')}>
                {t.agentSave}
              </button>
            </>
          )}
          <button className="btn" style={{ marginInlineStart: 'auto' }} onClick={onClose}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  )
}
