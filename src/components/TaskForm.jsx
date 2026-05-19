import { useState } from 'react'

export default function TaskForm({ task, defaultStatus, projectId, onSave, onClose }) {
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    status: task?.status || defaultStatus || 'todo',
    priority: task?.priority || 'medium',
    estimatedHours: task?.estimatedHours ?? '',
    actualHours: task?.actualHours ?? '',
    dueDate: task?.dueDate || '',
    assignee: task?.assignee || '',
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setSaving(true)
    await onSave({
      ...form,
      estimatedHours: form.estimatedHours === '' ? null : Number(form.estimatedHours),
      actualHours: form.actualHours === '' ? null : Number(form.actualHours),
    })
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{task ? 'Edit Task' : 'New Task'}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Title *</label>
              <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Design login screen" autoFocus required />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="Details, acceptance criteria, notes..." rows={3} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Status</label>
                <select value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="todo">To Do</option>
                  <option value="in_progress">In Progress</option>
                  <option value="review">Review</option>
                  <option value="done">Done</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>
              <div className="form-group">
                <label>Priority</label>
                <select value={form.priority} onChange={e => set('priority', e.target.value)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Estimated Hours</label>
                <input type="number" min="0" step="0.5" value={form.estimatedHours} onChange={e => set('estimatedHours', e.target.value)} placeholder="e.g. 4" />
              </div>
              <div className="form-group">
                <label>Actual Hours</label>
                <input type="number" min="0" step="0.5" value={form.actualHours} onChange={e => set('actualHours', e.target.value)} placeholder="filled when done" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Due Date</label>
                <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Assignee</label>
                <input value={form.assignee} onChange={e => set('assignee', e.target.value)} placeholder="Name or @handle" />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : task ? 'Save Changes' : 'Add Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
