import { useState } from 'react'
import AIPanel from './AIPanel.jsx'
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
  project, tasks, onUpdateProject, onDeleteProject, onEditProject,
  onCreateTask, onUpdateTask, onDeleteTask, onBulkCreateTasks
}) {
  const { t } = useLang()
  const [showAI, setShowAI] = useState(false)
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
    if (task && task.status !== colKey) onUpdateTask(draggingId, { status: colKey })
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
          <span className={`badge badge-${project.status}`}>{project.status}</span>
          <span className={`badge badge-${project.priority}`}>{project.priority}</span>
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
                    onStatusChange={(status) => onUpdateTask(task.id, { status })}
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

      {taskForm && (
        <TaskForm
          task={taskForm.task}
          defaultStatus={taskForm.status}
          projectId={project.id}
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
          onClose={() => setShowAI(false)}
          onApplyTasks={onBulkCreateTasks}
        />
      )}
    </div>
  )
}

function TaskCard({ task, isDragging, onDragStart, onEdit, onDelete }) {
  const { t } = useLang()
  const cls = dueCls(task.dueDate, task.status)

  return (
    <div
      className={`task-card${isDragging ? ' dragging' : ''}`}
      draggable
      onDragStart={onDragStart}
    >
      <div className="task-title">{task.title}</div>
      {task.description && <div className="task-desc">{task.description.slice(0, 80)}{task.description.length > 80 ? '…' : ''}</div>}
      <div className="task-meta">
        <span className={`badge badge-${task.priority}`}>{task.priority}</span>
        {task.estimatedHours && <span className="task-hours">{task.estimatedHours}h</span>}
        {task.dueDate && <span className={`task-due ${cls}`}>{fmtDate(task.dueDate, t.dateLocale)}</span>}
        {task.assignee && <span className="text-muted text-sm">{task.assignee}</span>}
      </div>
      <div className="task-actions">
        <button className="btn btn-sm" onClick={onEdit}>{t.edit}</button>
        <button className="btn btn-sm btn-danger" onClick={onDelete}>×</button>
      </div>
    </div>
  )
}
