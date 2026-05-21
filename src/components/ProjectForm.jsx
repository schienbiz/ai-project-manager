import { useState } from 'react'
import { useLang } from '../i18n.js'
import { api } from '../api.js'

export default function ProjectForm({ project, onSave, onClose }) {
  const { t, lang } = useLang()
  const [form, setForm] = useState({
    name:        project?.name        || '',
    description: project?.description || '',
    goal:        project?.goal        || '',
    status:      project?.status      || 'active',
    priority:    project?.priority    || 'medium',
    startDate:   project?.startDate   || '',
    dueDate:     project?.dueDate     || '',
  })
  const [saving, setSaving] = useState(false)
  const [translating, setTranslating] = useState(false)

  const handleTranslate = async () => {
    const fields = { name: form.name, goal: form.goal, description: form.description }
    setTranslating(true)
    try {
      const result = await api.translateFields({ fields, lang })
      setForm(f => ({
        ...f,
        name:        result.name        ?? f.name,
        goal:        result.goal        ?? f.goal,
        description: result.description ?? f.description,
      }))
    } catch {}
    setTranslating(false)
  }

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
          <h3>{project ? t.editProject : t.newProjectTitle}</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button
                type="button"
                className="btn btn-ai btn-sm"
                onClick={handleTranslate}
                disabled={translating}
              >
                {translating ? t.translating : t.translateBtn}
              </button>
            </div>
            <div className="form-group">
              <label>{t.projectNameLabel}</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder={t.projectNamePlaceholder} autoFocus required />
            </div>
            <div className="form-group">
              <label>{t.goalLabel}</label>
              <input value={form.goal} onChange={e => set('goal', e.target.value)} placeholder={t.goalPlaceholder} />
            </div>
            <div className="form-group">
              <label>{t.descriptionLabel}</label>
              <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder={t.descPlaceholder} rows={3} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t.statusLabel}</label>
                <select value={form.status} onChange={e => set('status', e.target.value)}>
                  <option value="active">{t.statusActive}</option>
                  <option value="paused">{t.statusPaused}</option>
                  <option value="completed">{t.statusCompleted}</option>
                  <option value="archived">{t.statusArchived}</option>
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
                <label>{t.startDateLabel}</label>
                <input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} />
              </div>
              <div className="form-group">
                <label>{t.dueDateLabel}</label>
                <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>{t.cancel}</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? t.saving : project ? t.saveChanges : t.createProject}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
