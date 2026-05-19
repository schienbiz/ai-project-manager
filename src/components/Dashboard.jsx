function fmtDate(d) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function progressPct(tasks, projectId) {
  const pt = tasks.filter(t => t.projectId === projectId)
  if (!pt.length) return 0
  return Math.round(pt.filter(t => t.status === 'done').length / pt.length * 100)
}

export default function Dashboard({ stats, projects, tasks, onSelectProject, onNewProject }) {
  if (!stats) return <div className="loading">Loading...</div>

  return (
    <div className="dashboard">
      <div className="flex items-center gap-12" style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Dashboard</h1>
        <button className="btn btn-primary ml-auto" onClick={onNewProject}>+ New Project</button>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <StatCard label="Active Projects" value={stats.activeProjects} total={stats.totalProjects} className="accent" />
        <StatCard label="Tasks In Progress" value={stats.inProgressTasks} className="accent" />
        <StatCard label="Blocked" value={stats.blockedTasks} className={stats.blockedTasks > 0 ? 'danger' : ''} />
        <StatCard label="Overdue" value={stats.overdueTasks} className={stats.overdueTasks > 0 ? 'danger' : 'success'} />
        <StatCard label="Done" value={stats.doneTasks} className="success" />
        <StatCard label="Completed Projects" value={stats.completedProjects} className="success" />
      </div>

      {/* Upcoming deadlines */}
      {stats.upcomingProjects?.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="section-title">Due This Week</div>
          <div className="deadline-list">
            {stats.upcomingProjects.map(p => (
              <div key={p.id} className="deadline-item" onClick={() => onSelectProject(p.id)} style={{ cursor: 'pointer' }}>
                <span>{p.name}</span>
                <span style={{ color: 'var(--warning)', fontSize: 12 }}>{fmtDate(p.dueDate)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Projects overview */}
      {projects.length > 0 ? (
        <>
          <div className="section-title">All Projects</div>
          <div className="projects-grid">
            {projects.map(p => {
              const pct = progressPct(tasks, p.id)
              const taskCount = tasks.filter(t => t.projectId === p.id).length
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
                    <span className="text-muted text-sm">{taskCount} tasks · {pct}%</span>
                    {p.dueDate && <span className="text-muted text-sm ml-auto">{fmtDate(p.dueDate)}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <div className="empty-state">
          <div className="icon">📋</div>
          <p>No projects yet. Create one to get started.</p>
          <button className="btn btn-primary" onClick={onNewProject}>+ New Project</button>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, total, className = '' }) {
  return (
    <div className={`stat-card ${className}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {total !== undefined && <div className="sub">of {total} total</div>}
    </div>
  )
}
