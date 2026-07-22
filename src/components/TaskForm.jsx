import { useState } from 'react'
import { api } from '../api.js'
import { useLang } from '../i18n.js'

export default function TaskForm({ task, defaultStatus, projectId, projectName, projectTasks = [], onSave, onClose }) {
  const { t, lang } = useLang()
  const CONFIDENCE_LABEL = { low: t.priorityLow, medium: t.priorityMedium, high: t.priorityHigh }
  const [translating, setTranslating] = useState(false)
  const [form, setForm] = useState({
    title:          task?.title          || '',
    description:    task?.description    || '',
    status:         task?.status         || defaultStatus || 'todo',
    priority:       task?.priority       || 'medium',
    estimatedHours: task?.estimatedHours ?? '',
    actualHours:    task?.actualHours    ?? '',
    dueDate:        task?.dueDate        || '',
    assignee:       task?.assignee       || '',
    acceptanceCriteria: task?.acceptanceCriteria || '',
    dependsOn:      task?.dependsOn      || [],
  })
  const depOptions = projectTasks.filter(x => x.id !== task?.id)
  const toggleDep = (id) => setForm(f => ({
    ...f,
    dependsOn: f.dependsOn.includes(id) ? f.dependsOn.filter(d => d !== id) : [...f.dependsOn, id],
  }))
  const [saving, setSaving] = useState(false)
  const [estimate, setEstimate] = useState(null)
  const [estimating, setEstimating] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleTranslate = async () => {
    const fields = { name: form.title, goal: form.description }
    setTranslating(true)
    try {
      const result = await api.translateFields({ fields, lang })
      setForm(f => ({
        ...f,
        title:       result.name ?? f.title,
        description: result.goal ?? f.description,
      }))
    } catch {}
    setTranslating(false)
  }

  const handleEstimate = async () => {
    if (!form.title.trim()) return
    setEstimating(true)
    setEstimate(null)
    try {
      const result = await api.estimateTask({
        title: form.title,
        description: form.description,
        projectContext: projectName || 'Software project',
        lang,
      })
      setEstimate(result)
    } catch {}
    setEstimating(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) return
    setSaving(true)
    try {
      await onSave({
        ...form,
        estimatedHours: form.estimatedHours === '' ? null : Number(form.estimatedHours),
        actualHours:    form.actualHours    === '' ? null : Number(form.actualHours),
      })
    } finally { setSaving(false) }
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
              <label>{t.titleLabel}</label>
              <input value={form.title} onChange={e => set('title', e.target.value)} placeholder={t.taskTitlePlaceholder} autoFocus required />
            </div>
            <div className="form-group">
              <label>{t.descriptionLabel}</label>
              <textarea value={form.description} onChange={e => set('description', e.target.value)} placeholder={t.taskDescPlaceholder} rows={3} />
            </div>
            <div className="form-group">
              <label>✓ {t.acceptanceCriteria}</label>
              <textarea value={form.acceptanceCriteria} onChange={e => set('acceptanceCriteria', e.target.value)} placeholder={t.acPlaceholder} rows={2} />
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                  <label style={{ margin: 0 }}>{t.estHours}</label>
                  <button
                    type="button"
                    className="btn btn-sm btn-ai"
                    style={{ padding: '2px 8px', fontSize: 11 }}
                    onClick={handleEstimate}
                    disabled={estimating || !form.title.trim()}
                  >
                    {estimating ? t.estimating : t.aiEstimate}
                  </button>
                </div>
                <input type="number" min="0" step="0.5" value={form.estimatedHours} onChange={e => set('estimatedHours', e.target.value)} placeholder={t.estHoursPlaceholder} />
              </div>
              <div className="form-group">
                <label>{t.actHours}</label>
                <input type="number" min="0" step="0.5" value={form.actualHours} onChange={e => set('actualHours', e.target.value)} placeholder={t.actHoursPlaceholder} />
              </div>
            </div>

            {estimate && (
              <div className="estimate-result">
                <div className="estimate-result-header">
                  <span className="estimate-hours">{estimate.hours}h</span>
                  <span className={`estimate-conf conf-${estimate.confidence}`}>{CONFIDENCE_LABEL[estimate.confidence] ?? estimate.confidence}</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    style={{ marginLeft: 'auto', padding: '2px 10px', fontSize: 11 }}
                    onClick={() => { set('estimatedHours', estimate.hours); setEstimate(null) }}
                  >
                    {t.acceptEstimate}
                  </button>
                </div>
                {estimate.rationale && <div className="estimate-rationale">{estimate.rationale}</div>}
                {estimate.subtasks?.length > 0 && (
                  <div className="estimate-subtasks">
                    {estimate.subtasks.map((s, i) => <div key={i} className="estimate-subtask">• {s}</div>)}
                  </div>
                )}
              </div>
            )}

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

            {depOptions.length > 0 && (
              <div className="form-group">
                <label>🔗 {t.dependsOnLabel}</label>
                <div className="dep-picker">
                  {depOptions.map(d => (
                    <label key={d.id} className={`dep-option ${form.dependsOn.includes(d.id) ? 'on' : ''}`}>
                      <input type="checkbox" checked={form.dependsOn.includes(d.id)} onChange={() => toggleDep(d.id)} />
                      <span>{d.title}</span>
                    </label>
                  ))}
                </div>
                <div className="dep-hint">{t.dependsOnHint}</div>
              </div>
            )}
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
