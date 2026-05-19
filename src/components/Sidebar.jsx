import { useLang } from '../i18n.js'

const STATUS_DOT = { active: 'dot-active', paused: 'dot-paused', completed: 'dot-completed', archived: 'dot-archived' }

export default function Sidebar({ projects, selectedId, onSelect, onDashboard, onNewProject, view }) {
  const { lang, setLang, t } = useLang()
  const active   = projects.filter(p => p.status === 'active')
  const inactive = projects.filter(p => p.status !== 'active')

  return (
    <div className="sidebar">
      <div className="sidebar-logo">
        <span>🤖</span> {t.appName}
      </div>

      <div className="sidebar-section">
        <div
          className={`sidebar-item ${view === 'dashboard' ? 'active' : ''}`}
          onClick={onDashboard}
        >
          <span style={{ fontSize: 14 }}>🏠</span>
          <span className="name">{t.dashboard}</span>
        </div>

        {active.length > 0 && (
          <>
            <div className="sidebar-label">{t.active}</div>
            {active.map(p => (
              <SidebarProject key={p.id} p={p} selectedId={selectedId} onSelect={onSelect} view={view} />
            ))}
          </>
        )}

        {inactive.length > 0 && (
          <>
            <div className="sidebar-label" style={{ marginTop: 8 }}>{t.other}</div>
            {inactive.map(p => (
              <SidebarProject key={p.id} p={p} selectedId={selectedId} onSelect={onSelect} view={view} />
            ))}
          </>
        )}

        {projects.length === 0 && (
          <div style={{ padding: '12px 8px', color: 'var(--muted)', fontSize: 12 }}>
            {t.noProjects}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button className="btn-new" onClick={onNewProject}>{t.newProject}</button>
        <button
          className="btn-lang"
          onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
          title="Switch language / 切換語言"
        >
          {t.langToggle}
        </button>
      </div>
    </div>
  )
}

function SidebarProject({ p, selectedId, onSelect, view }) {
  const isSelected = view === 'project' && p.id === selectedId
  return (
    <div
      className={`sidebar-item ${isSelected ? 'active' : ''}`}
      onClick={() => onSelect(p.id)}
    >
      <span className={`dot ${STATUS_DOT[p.status] || 'dot-active'}`} />
      <span className="name" title={p.name}>{p.name}</span>
      {p.priority === 'urgent' && <span className="badge" style={{ background: 'rgba(248,81,73,.2)', color: 'var(--danger)' }}>!</span>}
    </div>
  )
}
