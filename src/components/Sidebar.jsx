import { useLang } from '../i18n.js'

const STATUS_DOT = { active: 'dot-active', paused: 'dot-paused', completed: 'dot-completed', archived: 'dot-archived' }

export default function Sidebar({ projects, selectedId, onSelect, onDashboard, onAdmin, onNewProject, view, collapsed, onToggleCollapse }) {
  const { lang, setLang, t } = useLang()
  const active   = projects.filter(p => p.status === 'active')
  const inactive = projects.filter(p => p.status !== 'active')

  return (
    <div className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <button
        className="sidebar-collapse-btn"
        onClick={onToggleCollapse}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? '›' : '‹'}
      </button>

      <div className="sidebar-logo">
        <span>🤖</span>
        <span className="sidebar-logo-text">{t.appName}</span>
      </div>

      <div className="sidebar-section">
        <div
          className={`sidebar-item ${view === 'dashboard' ? 'active' : ''}`}
          onClick={onDashboard}
          title={collapsed ? t.dashboard : undefined}
        >
          <span style={{ fontSize: 14 }}>🏠</span>
          <span className="name">{t.dashboard}</span>
        </div>
        <div
          className={`sidebar-item ${view === 'admin' ? 'active' : ''}`}
          onClick={onAdmin}
          title={collapsed ? 'System Admin' : undefined}
        >
          <span style={{ fontSize: 14 }}>⚙️</span>
          <span className="name">System Admin</span>
        </div>

        {active.length > 0 && (
          <>
            <div className="sidebar-label">{t.active}</div>
            {active.map(p => (
              <SidebarProject key={p.id} p={p} selectedId={selectedId} onSelect={onSelect} view={view} collapsed={collapsed} />
            ))}
          </>
        )}

        {inactive.length > 0 && (
          <>
            <div className="sidebar-label" style={{ marginTop: 8 }}>{t.other}</div>
            {inactive.map(p => (
              <SidebarProject key={p.id} p={p} selectedId={selectedId} onSelect={onSelect} view={view} collapsed={collapsed} />
            ))}
          </>
        )}

        {projects.length === 0 && !collapsed && (
          <div style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: 12 }}>
            {t.noProjects}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="btn-new" onClick={onNewProject} title={collapsed ? t.newProject : undefined}>
          {collapsed ? '+' : <span className="btn-new-text">{t.newProject}</span>}
        </button>
        {!collapsed && (
          <div className="lang-switcher">
            <button className={`btn-lang-opt${lang === 'en' ? ' active' : ''}`} onClick={() => setLang('en')}>EN</button>
            <button className={`btn-lang-opt${lang === 'zh' ? ' active' : ''}`} onClick={() => setLang('zh')}>繁中</button>
            <button className={`btn-lang-opt${lang === 'ar' ? ' active' : ''}`} onClick={() => setLang('ar')}>ع</button>
          </div>
        )}
      </div>
    </div>
  )
}

function SidebarProject({ p, selectedId, onSelect, view, collapsed }) {
  const isSelected = view === 'project' && p.id === selectedId
  return (
    <div
      className={`sidebar-item ${isSelected ? 'active' : ''}`}
      onClick={() => onSelect(p.id)}
      title={collapsed ? p.name : undefined}
    >
      <span className={`dot ${STATUS_DOT[p.status] || 'dot-active'}`} />
      <span className="name" title={p.name}>{p.name}</span>
      {p.priority === 'urgent' && <span className="badge" style={{ background: 'rgba(248,81,73,.2)', color: 'var(--danger)' }}>!</span>}
    </div>
  )
}
