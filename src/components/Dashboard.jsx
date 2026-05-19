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

export default function Dashboard({ stats, projects, tasks, onSelectProject, onNewProject }) {
  const { t } = useLang()
  if (!stats) return <div className="loading">{t.loading}</div>

  return (
    <div className="dashboard">
      <div className="flex items-center gap-12" style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>{t.dashboard}</h1>
        <button className="btn btn-primary ml-auto" onClick={onNewProject}>{t.newProject}</button>
      </div>

      <div className="stats-grid">
        <StatCard label={t.activeProjects}    value={stats.activeProjects}    total={stats.totalProjects} ofTotal={t.ofTotal} className="accent" />
        <StatCard label={t.tasksInProgress}   value={stats.inProgressTasks}   className="accent" />
        <StatCard label={t.blocked}           value={stats.blockedTasks}      className={stats.blockedTasks > 0 ? 'danger' : ''} />
        <StatCard label={t.overdue}           value={stats.overdueTasks}      className={stats.overdueTasks > 0 ? 'danger' : 'success'} />
        <StatCard label={t.done}              value={stats.doneTasks}         className="success" />
        <StatCard label={t.completedProjects} value={stats.completedProjects} className="success" />
      </div>

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
                    <span className={`badge badge-${p.priority}`}>{p.priority}</span>
                  </div>
                  {p.description && <div className="pc-desc">{p.description.slice(0, 80)}{p.description.length > 80 ? '…' : ''}</div>}
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="pc-meta">
                    <span className={`badge badge-${p.status}`}>{p.status}</span>
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
