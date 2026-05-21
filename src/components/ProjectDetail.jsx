import { useState, useRef } from 'react'
import AIPanel from './AIPanel.jsx'
import AgentPanel from './AgentPanel.jsx'
import TaskForm from './TaskForm.jsx'
import { useLang } from '../i18n.js'

function fmtDate(d, locale) {
  if (!d) return null
  return new Date(d + 'T00:00:00').toLocaleDateString(locale, { month: 'short', day: 'numeric' })
}

function dueCls(dueDate, status) {
  if (!dueDate || status === 'done') return ''
  const today = new Date().toISOString().split('T')[0]
  const diff = (new Date(dueDate) - new Date(today)) / 86400000
  if (diff < 0) return 'overdue'
  if (diff <= 3) return 'soon'
  return 'ok'
}

export default function ProjectDetail({
  project, tasks, notes = [], allProjects = [], allTasks = [],
  onUpdateProject, onDeleteProject, onEditProject,
  onCreateTask, onUpdateTask, onDeleteTask, onBulkCreateTasks,
  onCreateNote, onDeleteNote, onRetryAgent,
}) {
  const { t, lang } = useLang()
  const STATUS_LABEL = { active: t.statusActive, paused: t.statusPaused, completed: t.statusCompleted, archived: t.statusArchived }
  const PRIORITY_LABEL = { low: t.priorityLow, medium: t.priorityMedium, high: t.priorityHigh, urgent: t.priorityUrgent }
  const [showAI, setShowAI] = useState(false)
  const [agentTask, setAgentTask] = useState(null)
  const [taskForm, setTaskForm] = useState(null)
  const [draggingId, setDraggingId] = useState(null)
  const [dragOver, setDragOver] = useState(null)

  const COLUMNS = [
    { key: 'todo',        label: t.colTodo,       color: 'var(--todo)' },
    { key: 'in_progress', label: t.colInProgress,  color: 'var(--in-progress)' },
    { key: 'review',      label: t.colReview,      color: 'var(--review)' },
    { key: 'done',        label: t.colDone,        color: 'var(--done)' },
    { key: 'blocked',     label: t.colBlocked,     color: 'var(--blocked)' },
  ]

  const done  = tasks.filter(t2 => t2.status === 'done').length
  const total = tasks.length
  const pct   = total ? Math.round(done / total * 100) : 0

  const handleDrop = (colKey) => {
    if (!draggingId || dragOver === null) return
    const task = tasks.find(t2 => t2.id === draggingId)
    if (task && task.status !== colKey) onUpdateTask(draggingId, { status: colKey, _lang: lang })
    setDraggingId(null)
    setDragOver(null)
  }

  return (
    <div className="project-detail">
      <div className="project-header">
        <div className="flex items-center gap-8">
          <h2 style={{ flex: 1 }}>{project.name}</h2>
          <button className="btn btn-ai btn-sm" onClick={() => setShowAI(true)}>{t.aiAssistant}</button>
          <button className="btn btn-sm" onClick={onEditProject}>{t.edit}</button>
          <button className="btn btn-danger btn-sm" onClick={onDeleteProject}>{t.delete}</button>
        </div>
        {project.goal && <div className="project-goal">{project.goal}</div>}
        <div className="project-meta-row" style={{ marginTop: 8 }}>
          <span className={`badge badge-${project.status}`}>{STATUS_LABEL[project.status] ?? project.status}</span>
          <span className={`badge badge-${project.priority}`}>{PRIORITY_LABEL[project.priority] ?? project.priority}</span>
          {project.dueDate && <span className="text-muted text-sm">{t.due} {fmtDate(project.dueDate, t.dateLocale)}</span>}
          <span className="text-muted text-sm ml-auto">{t.taskCount(done, total, pct)}</span>
        </div>
        <div className="progress-bar" style={{ marginTop: 10, marginBottom: 0 }}>
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="kanban">
        {COLUMNS.map(col => {
          const colTasks = tasks.filter(t2 => t2.status === col.key).sort((a, b) => a.sortOrder - b.sortOrder)
          return (
            <div key={col.key} className="kanban-col">
              <div className="kanban-col-header">
                <span className="col-title">
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.color, display: 'inline-block' }} />
                  {col.label}
                </span>
                <span className="col-count">{colTasks.length}</span>
              </div>
              <div
                className={`kanban-body${dragOver === col.key ? ' drag-over' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOver(col.key) }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => handleDrop(col.key)}
              >
                {colTasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    isDragging={draggingId === task.id}
                    onDragStart={() => setDraggingId(task.id)}
                    onEdit={() => setTaskForm({ status: task.status, task })}
                    onDelete={() => onDeleteTask(task.id)}
                    onStatusChange={(status) => onUpdateTask(task.id, { status, _lang: lang })}
                    onQuickDone={() => onUpdateTask(task.id, { status: task.status === 'done' ? 'todo' : 'done', _lang: lang })}
                    onRunAgent={() => setAgentTask(task)}
                    onRetryAgent={() => onRetryAgent?.(task.id)}
                  />
                ))}
                <button className="kanban-add" onClick={() => setTaskForm({ status: col.key })}>
                  {t.addTaskBtn}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <NotesSection notes={notes} onCreateNote={onCreateNote} onDeleteNote={onDeleteNote} />

      {taskForm && (
        <TaskForm
          task={taskForm.task}
          defaultStatus={taskForm.status}
          projectId={project.id}
          projectName={project.name}
          onSave={async (data) => {
            if (taskForm.task) {
              await onUpdateTask(taskForm.task.id, data)
            } else {
              await onCreateTask({ ...data, projectId: project.id })
            }
            setTaskForm(null)
          }}
          onClose={() => setTaskForm(null)}
        />
      )}

      {showAI && (
        <AIPanel
          project={project}
          tasks={tasks}
          allProjects={allProjects}
          allTasks={allTasks}
          onClose={() => setShowAI(false)}
          onApplyTasks={onBulkCreateTasks}
          onCreateNote={onCreateNote}
        />
      )}

      {agentTask && (
        <AgentPanel
          task={agentTask}
          project={project}
          onClose={() => setAgentTask(null)}
          onApprove={(taskId, output, action) => {
            const updates = { agentOutput: output, agentStatus: action }
            if (action === 'approved') updates.status = 'review'
            onUpdateTask(taskId, updates)
          }}
        />
      )}
    </div>
  )
}

function NotesSection({ notes, onCreateNote, onDeleteNote }) {
  const { t } = useLang()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const taRef = useRef(null)

  const save = async () => {
    const trimmed = text.trim()
    if (!trimmed) return
    setSaving(true)
    await onCreateNote(trimmed)
    setText('')
    setSaving(false)
    taRef.current?.focus()
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save() }
  }

  return (
    <div className="notes-section">
      <div className="notes-header">
        <span className="section-title" style={{ margin: 0 }}>{t.notesTitle}</span>
        <span className="text-muted text-sm">{notes.length}</span>
      </div>

      <div className="notes-compose">
        <textarea
          ref={taRef}
          className="notes-textarea"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder={t.notesPlaceholder}
          rows={3}
        />
        <button className="btn btn-primary btn-sm notes-save" onClick={save} disabled={saving || !text.trim()}>
          {t.noteSave}
        </button>
      </div>

      {notes.length === 0 ? (
        <div className="notes-empty">{t.notesEmpty}</div>
      ) : (
        <div className="notes-list">
          {notes.map(note => (
            <NoteCard key={note.id} note={note} onDelete={() => onDeleteNote(note.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function NoteCard({ note, onDelete }) {
  const { t } = useLang()
  const dt = new Date(note.createdAt).toLocaleString(t.dateLocale, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  return (
    <div className="note-card">
      <div className="note-meta">
        <span className="note-date">{dt}</span>
        <button className="btn btn-sm btn-danger note-del" onClick={onDelete}>×</button>
      </div>
      <div className="note-content">{note.content}</div>
    </div>
  )
}

function TaskCard({ task, isDragging, onDragStart, onEdit, onDelete, onQuickDone, onRunAgent, onRetryAgent }) {
  const { t } = useLang()
  const PRIORITY_LABEL = { low: t.priorityLow, medium: t.priorityMedium, high: t.priorityHigh, urgent: t.priorityUrgent }
  const cls = dueCls(task.dueDate, task.status)
  const isDone = task.status === 'done'
  const agentBadge = task.agentStatus === 'approved'
    ? { icon: '🤖✓', cls: 'agent-badge-approved', title: t.agentApprovedLabel }
    : task.agentStatus === 'saved'
      ? { icon: '🤖', cls: 'agent-badge-saved', title: t.agentSavedLabel }
      : task.agentStatus === 'running'
        ? { icon: '⏳', cls: 'agent-badge-running', title: t.agentRunningLabel }
        : task.agentStatus === 'error'
          ? { icon: '⚠️', cls: 'agent-badge-error', title: t.agentErrorLabel }
          : null

  return (
    <div
      className={`task-card${isDragging ? ' dragging' : ''}${isDone ? ' task-done' : ''}`}
      draggable
      onDragStart={onDragStart}
    >
      <div className="task-card-top">
        <div
          className={`task-done-check${isDone ? ' checked' : ''}`}
          onClick={(e) => { e.stopPropagation(); onQuickDone() }}
          title={isDone ? t.quickReopenLabel : t.quickDoneLabel}
        />
        <div className="task-title">{task.title}</div>
        {agentBadge && (
          <span
            className={`agent-badge ${agentBadge.cls}`}
            title={agentBadge.title}
            onClick={task.agentStatus === 'error' ? (e) => { e.stopPropagation(); onRetryAgent?.() } : undefined}
            style={task.agentStatus === 'error' ? { cursor: 'pointer' } : undefined}
          >
            {agentBadge.icon}
          </span>
        )}
      </div>
      {task.description && <div className="task-desc">{task.description.slice(0, 80)}{task.description.length > 80 ? '…' : ''}</div>}
      <div className="task-meta">
        <span className={`badge badge-${task.priority}`}>{PRIORITY_LABEL[task.priority] ?? task.priority}</span>
        {isDone && task.actualHours
          ? <span className="task-hours task-actual">{task.actualHours}h ✓</span>
          : task.estimatedHours
            ? <span className="task-hours">{task.estimatedHours}h</span>
            : null
        }
        {task.dueDate && <span className={`task-due ${cls}`}>{fmtDate(task.dueDate, t.dateLocale)}</span>}
        {task.assignee && <span className="text-muted text-sm">{task.assignee}</span>}
      </div>
      <div className="task-actions">
        <button className="btn btn-sm btn-ai" onClick={onRunAgent} title={t.agentRun}>🤖</button>
        <button className="btn btn-sm" onClick={onEdit}>{t.edit}</button>
        <button className="btn btn-sm btn-danger" onClick={onDelete}>×</button>
      </div>
    </div>
  )
}
