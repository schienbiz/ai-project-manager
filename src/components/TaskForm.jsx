import { useState } from 'react'
import { useLang } from '../i18n.js'

export default function TaskForm({ task, defaultStatus, projectId, onSave, onClose }) {
  const { t } = useLang()
  const [form, setForm] = useState({
    title:          task?.title          || '',
    description:    task?.description    || '',
    status:         task?.status         || defaultStatus || 'todo',
    priority:       task?.priority       || 'medium',
    estimatedHours: task?.estimatedHours ?? '',
    actualHours:    task?.actualHours    ?? '',
    dueDate:        task?.dueDate        || '',
    assignee:       task?.assignee       || '',
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
      actualHours:    form.actualHours    === '' ? null : Number(form.actualHours),
    })
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{task ? t.editTask : t.newTask}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label>{t.titleLabel}</label>
              <input value={form.title} onChange={e => set('title', e.target.value)} placeholder={t.taskTitlePlaceholder} autoFocus required />
            </div>
            <div className="form-group">
              <label>{t.descriptionLabel}</label>
              <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder={t.taskDescPlaceholder} rows={3} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t.statusLabel}</label>
                <select value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="todo">{t.statusTodo}</option>
                  <option value="in_progress">{t.statusInProgress}</option>
                  <option value="review">{t.statusReview}</option>
                  <option value="done">{t.statusDone}</option>
                  <option value="blocked">{t.statusBlocked}</option>
                </select>
              </div>
              <div className="form-group">
                <label>{t.priorityLabel}</label>
                <select value={form.priority} onChange={e => set('priority', e.target.value)}>
                  <option value="low">{t.priorityLow}</option>
                  <option value="medium">{t.priorityMedium}</option>
                  <option value="high">{t.priorityHigh}</option>
                  <option value="urgent">{t.priorityUrgent}</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t.estHours}</label>
                <input type="number" min="0" step="0.5" value={form.estimatedHours} onChange={e => set('estimatedHours', e.target.value)} placeholder={t.estHoursPlaceholder} />
              </div>
              <div className="form-group">
                <label>{t.actHours}</label>
                <input type="number" min="0" step="0.5" value={form.actualHours} onChange={e => set('actualHours', e.target.value)} placeholder={t.actHoursPlaceholder} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t.dueDateLabel}</label>
                <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
              </div>
              <div className="form-group">
                <label>{t.assignee}</label>
                <input value={form.assignee} onChange={e => set('assignee', e.target.value)} placeholder={t.assigneePlaceholder} />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>{t.cancel}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t.saving : task ? t.saveChanges : t.addTask}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
