import { useState } from 'react'

export default function ProjectForm({ project, onSave, onClose }) {
  const [form, setForm] = useState({
    name: project?.name || '',
    description: project?.description || '',
    goal: project?.goal || '',
    status: project?.status || 'active',
    priority: project?.priority || 'medium',
    startDate: project?.startDate || '',
    dueDate: project?.dueDate || '',
  })
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    setSaving(true)
    await onSave(form)
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{project ? 'Edit Project' : 'New Project'}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>Project Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Mobile App Redesign" autoFocus required />
            </div>
            <div className="form-group">
              <label>Goal</label>
              <input value={form.goal} onChange={e => set('goal', e.target.value)} placeholder="What does success look like?" />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder="Brief description of the project..." rows={3} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Status</label>
                <select value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
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
                <label>Start Date</label>
                <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Due Date</label>
                <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : project ? 'Save Changes' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
