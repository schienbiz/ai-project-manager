import { useState, useRef, useCallback } from 'react'
import AIPanel from './AIPanel.jsx'
import RiskPanel from './RiskPanel.jsx'
import AgentPanel from './AgentPanel.jsx'
import TaskForm from './TaskForm.jsx'
import { useLang } from '../i18n.js'

function KanbanFilters({ filter, onChange, tasks }) {
  const { t } = useLang()
  const today = new Date().toISOString().split('T')[0]
  const hasActive = filter.priority || filter.agent || filter.search

  return (
    <div className="kanban-filters">
      <button
        className={`filter-btn${!filter.priority && !filter.agent ? ' active' : ''}`}
        onClick={() => onChange({ priority: null, agent: null, search: filter.search })}
      >{t.filterAll}</button>

      <span className="filter-divider" />

      {['high', 'urgent'].map(p => (
        <button
          key={p}
          className={`filter-btn${filter.priority === p ? ' active' : ''}`}
          onClick={() => onChange({ ...filter, priority: filter.priority === p ? null : p })}
        >
          {p === 'urgent' ? '🔴' : '🟠'} {t[`priority${p.charAt(0).toUpperCase() + p.slice(1)}`]}
        </button>
      ))}

      <button
        className={`filter-btn${filter.priority === 'blocked' ? ' active' : ''}`}
        onClick={() => onChange({ ...filter, priority: filter.priority === 'blocked' ? null : 'blocked' })}
      >{t.filterBlocked}</button>

      <button
        className={`filter-btn${filter.agent === 'overdue' ? ' active' : ''}`}
        onClick={() => onChange({ ...filter, agent: filter.agent === 'overdue' ? null : 'overdue' })}
      >⏰ {t.filterOverdue}</button>

      <button
        className={`filter-btn${filter.agent === 'has_ai' ? ' active' : ''}`}
        onClick={() => onChange({ ...filter, agent: filter.agent === 'has_ai' ? null : 'has_ai' })}
      >🤖 {t.filterHasAI}</button>

      <button
        className={`filter-btn${filter.agent === 'running' ? ' active' : ''}`}
        onClick={() => onChange({ ...filter, agent: filter.agent === 'running' ? null : 'running' })}
      >⏳ {t.filterRunning}</button>

      <span className="filter-divider" />

      <input
        className="filter-search"
        placeholder={t.filterSearch}
        value={filter.search || ''}
        onChange={e => onChange({ ...filter, search: e.target.value })}
      />

      {hasActive && (
        <button className="filter-clear" onClick={() => onChange({ priority: null, agent: null, search: '' })}>
          {t.filterClear}
        </button>
      )}
    </div>
  )
}

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
  const [showRisks, setShowRisks] = useState(false)
  const [agentTask, setAgentTask] = useState(null)
  const [taskForm, setTaskForm] = useState(null)
  const [editingGuide, setEditingGuide] = useState(false)
  const [guideDraft, setGuideDraft] = useState('')
  const [guideSaving, setGuideSaving] = useState(false)

  const startGuideEdit = useCallback(() => {
    setGuideDraft(project.userGuide || '')
    setEditingGuide(true)
  }, [project.userGuide])

  const saveGuide = useCallback(async () => {
    setGuideSaving(true)
    await onUpdateProject({ ...project, userGuide: guideDraft })
    setGuideSaving(false)
    setEditingGuide(false)
  }, [project, guideDraft, onUpdateProject])
  const [draggingId, setDraggingId] = useState(null)
  const [dragOver, setDragOver] = useState(null)
  const [filter, setFilter] = useState({ priority: null, agent: null, search: '' })

  const today = new Date().toISOString().split('T')[0]
  const applyFilter = (ts) => {
    let result = ts
    if (filter.priority === 'blocked') result = result.filter(t2 => t2.status === 'blocked')
    else if (filter.priority) result = result.filter(t2 => t2.priority === filter.priority)
    if (filter.agent === 'overdue') result = result.filter(t2 => t2.dueDate && t2.dueDate < today && t2.status !== 'done')
    else if (filter.agent === 'has_ai') result = result.filter(t2 => t2.agentStatus)
    else if (filter.agent === 'running') result = result.filter(t2 => t2.agentStatus === 'running')
    if (filter.search) result = result.filter(t2 => t2.title.toLowerCase().includes(filter.search.toLowerCase()))
    return result
  }
  const filteredTasks = applyFilter(tasks)

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
          <button className="btn btn-ai btn-sm" onClick={() => { setShowAI(s => !s); setShowRisks(false) }}>{t.aiAssistant}</button>
          <button className="btn btn-sm" onClick={() => { setShowRisks(s => !s); setShowAI(false) }}>⚠️ {t.risksTab}</button>
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

      <div className="user-guide-section">
        <div className="user-guide-header">
          <span className="user-guide-title">{t.userGuideLabel}</span>
          {!editingGuide && (
            <button className="btn btn-sm" onClick={startGuideEdit}>{t.edit}</button>
          )}
        </div>
        {editingGuide ? (
          <div className="user-guide-edit">
            <textarea
              className="user-guide-textarea"
              value={guideDraft}
              onChange={e => setGuideDraft(e.target.value)}
              placeholder={t.userGuidePlaceholder}
              rows={5}
              autoFocus
            />
            <div className="user-guide-actions">
              <button className="btn btn-sm" onClick={() => setEditingGuide(false)} disabled={guideSaving}>{t.cancel}</button>
              <button className="btn btn-primary btn-sm" onClick={saveGuide} disabled={guideSaving}>
                {guideSaving ? t.saving : t.noteSave}
              </button>
            </div>
          </div>
        ) : (
          <div className="user-guide-body" onClick={startGuideEdit}>
            {project.userGuide
              ? <pre className="user-guide-pre">{project.userGuide}</pre>
              : <span className="user-guide-empty">{t.userGuidePlaceholder}</span>
            }
          </div>
        )}
      </div>

      <KanbanFilters filter={filter} onChange={setFilter} tasks={tasks} />

      <div className="project-body">
        <div className="project-content">
          <div className="kanban">
            {COLUMNS.map(col => {
              const colTasks = filteredTasks.filter(t2 => t2.status === col.key).sort((a, b) => a.sortOrder - b.sortOrder)
              const totalInCol = tasks.filter(t2 => t2.status === col.key).length
              return (
                <div key={col.key} className="kanban-col">
                  <div className="kanban-col-header">
                    <span className="col-title">
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.color, display: 'inline-block' }} />
                      {col.label}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="col-count">{colTasks.length}{colTasks.length !== totalInCol ? `/${totalInCol}` : ''}</span>
                      <button
                        className="kanban-col-add"
                        onClick={() => setTaskForm({ status: col.key })}
                        title={t.addTaskBtn}
                      >+</button>
                    </div>
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
                  </div>
                </div>
              )
            })}
          </div>

          <NotesSection notes={notes} onCreateNote={onCreateNote} onDeleteNote={onDeleteNote} />
        </div>

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

        {showRisks && (
          <RiskPanel project={project} onClose={() => setShowRisks(false)} />
        )}
      </div>

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
    try {
      await onCreateNote(trimmed)
      setText('')
      taRef.current?.focus()
    } finally { setSaving(false) }
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
      className={`task-card${isDragging ? ' dragging' : ''}${isDone ? ' task-done' : ''}${task.agentStatus === 'running' ? ' agent-running' : ''}`}
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
