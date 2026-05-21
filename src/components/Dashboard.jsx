import { useState, useEffect } from 'react'
import { api, streamAI } from '../api.js'
import { OutputText } from './AIPanel.jsx'
import { useLang } from '../i18n.js'

function fmtDate(d, locale) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString(locale, { month: 'short', day: 'numeric' })
}

function progressPct(tasks, projectId) {
  const pt = tasks.filter(t => t.projectId === projectId)
  if (!pt.length) return 0
  return Math.round(pt.filter(t => t.status === 'done').length / pt.length * 100)
}

export default function Dashboard({ stats, projects, tasks, onSelectProject, onNewProject, onQuickStart }) {
  const { t, lang } = useLang()
  const STATUS_LABEL = { active: t.statusActive, paused: t.statusPaused, completed: t.statusCompleted, archived: t.statusArchived }
  const PRIORITY_LABEL = { low: t.priorityLow, medium: t.priorityMedium, high: t.priorityHigh, urgent: t.priorityUrgent }
  const [insights, setInsights] = useState({ output: '', running: false, mode: null })

  // Clear cached AI output when language changes so stale Chinese/Arabic doesn't show in EN
  useEffect(() => { setInsights({ output: '', running: false, mode: null }) }, [lang])
  const [qs, setQs] = useState({ title: '', loading: false, msg: '' })

  const handleQuickStart = async (e) => {
    e.preventDefault()
    const title = qs.title.trim()
    if (!title || qs.loading) return
    setQs({ title, loading: true, msg: t.quickStartGenerating })
    try {
      const result = await api.quickStart(title, lang)
      setQs({ title: '', loading: false, msg: t.quickStartDone(result.tasks.length) })
      onQuickStart(result.project, result.tasks)
    } catch {
      setQs(s => ({ ...s, loading: false, msg: t.quickStartFailed }))
    }
  }

  const runInsights = (mode) => {
    setInsights({ output: '', running: true, mode })
    const endpoint = mode === 'report' ? '/pm/api/ai/weekly-report' : '/pm/api/ai/global-risks'
    streamAI(
      endpoint,
      { projects, tasks, lang },
      (chunk) => setInsights(s => ({ ...s, output: s.output + chunk })),
      () => setInsights(s => ({ ...s, running: false })),
      (err) => setInsights(s => ({ ...s, output: 'Error: ' + err, running: false })),
    )
  }

  if (!stats) return <div className="loading">{t.loading}</div>

  return (
    <div className="dashboard">
      <div className="flex items-center gap-12" style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>{t.dashboard}</h1>
        <button className="btn btn-primary ml-auto" onClick={onNewProject}>{t.newProject}</button>
      </div>

      <form className="qs-bar" onSubmit={handleQuickStart}>
        <input
          className="qs-input"
          type="text"
          placeholder={t.quickStartPlaceholder}
          value={qs.title}
          onChange={e => setQs(s => ({ ...s, title: e.target.value, msg: '' }))}
          disabled={qs.loading}
        />
        {qs.msg && <span className={`qs-msg${qs.msg.startsWith('❌') ? ' qs-err' : ''}`}>{qs.msg}</span>}
      </form>

      <div className="stats-grid">
        <StatCard label={t.activeProjects}    value={stats.activeProjects}    total={stats.totalProjects} ofTotal={t.ofTotal} className="accent" />
        <StatCard label={t.tasksInProgress}   value={stats.inProgressTasks}   className="accent" />
        <StatCard label={t.blocked}           value={stats.blockedTasks}      className={stats.blockedTasks > 0 ? 'danger' : ''} />
        <StatCard label={t.overdue}           value={stats.overdueTasks}      className={stats.overdueTasks > 0 ? 'danger' : 'success'} />
        <StatCard label={t.done}              value={stats.doneTasks}         className="success" />
        <StatCard label={t.completedProjects} value={stats.completedProjects} className="success" />
      </div>

      {/* Global AI Insights */}
      {projects.length > 0 && (
        <div className="ai-insights-section">
          <div className="flex items-center gap-8" style={{ marginBottom: insights.output ? 12 : 0 }}>
            <div className="section-title" style={{ margin: 0 }}>{t.globalAiInsights}</div>
            <button
              className={`btn btn-sm btn-ai${insights.running && insights.mode === 'report' ? ' btn-running' : ''}`}
              onClick={() => runInsights('report')}
              disabled={insights.running}
            >
              {insights.running && insights.mode === 'report' ? t.thinking : t.allProjectsReport}
            </button>
            <button
              className={`btn btn-sm btn-ai${insights.running && insights.mode === 'risks' ? ' btn-running' : ''}`}
              onClick={() => runInsights('risks')}
              disabled={insights.running}
            >
              {insights.running && insights.mode === 'risks' ? t.thinking : t.allProjectsRisks}
            </button>
          </div>
          {insights.output && (
            <div className="ai-insights-output">
              <OutputText text={insights.output} streaming={insights.running} />
            </div>
          )}
        </div>
      )}

      {stats.upcomingProjects?.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="section-title">{t.dueThisWeek}</div>
          <div className="deadline-list">
            {stats.upcomingProjects.map(p => (
              <div key={p.id} className="deadline-item" onClick={() => onSelectProject(p.id)} style={{ cursor: 'pointer' }}>
                <span>{p.name}</span>
                <span style={{ color: 'var(--warning)', fontSize: 12 }}>{fmtDate(p.dueDate, t.dateLocale)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {projects.length > 0 ? (
        <>
          <div className="section-title">{t.allProjects}</div>
          <div className="projects-grid">
            {projects.map(p => {
              const pct = progressPct(tasks, p.id)
              const taskCount = tasks.filter(t2 => t2.projectId === p.id).length
              return (
                <div key={p.id} className="project-card" onClick={() => onSelectProject(p.id)}>
                  <div className="pc-name">
                    {p.name}
                    <span className={`badge badge-${p.priority}`}>{PRIORITY_LABEL[p.priority] ?? p.priority}</span>
                  </div>
                  {p.description && <div className="pc-desc">{p.description.slice(0, 80)}{p.description.length > 80 ? '…' : ''}</div>}
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="pc-meta">
                    <span className={`badge badge-${p.status}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                    <span className="text-muted text-sm">{t.taskCount(tasks.filter(t2 => t2.projectId === p.id && t2.status === 'done').length, taskCount, pct)}</span>
                    {p.dueDate && <span className="text-muted text-sm ml-auto">{fmtDate(p.dueDate, t.dateLocale)}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <div className="empty-state">
          <div className="icon">📋</div>
          <p>{t.noProjectsMsg}</p>
          <button className="btn btn-primary" onClick={onNewProject}>{t.newProject}</button>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, total, ofTotal, className = '' }) {
  return (
    <div className={`stat-card ${className}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {total !== undefined && <div className="sub">{ofTotal(total)}</div>}
    </div>
  )
}
