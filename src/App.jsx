import { useState, useEffect, useCallback, useRef } from 'react'
import { api, adminAuth } from './api.js'
import { LangContext, T } from './i18n.js'
import Sidebar from './components/Sidebar.jsx'
import Dashboard from './components/Dashboard.jsx'
import ProjectDetail from './components/ProjectDetail.jsx'
import ProjectForm from './components/ProjectForm.jsx'
import AdminDashboard from './components/AdminDashboard.jsx'
import MarketingApp from './components/MarketingApp.jsx'
import CommandPalette from './components/CommandPalette.jsx'
import DecisionLog from './components/DecisionLog.jsx'
import Portfolio from './components/Portfolio.jsx'
import TemplateLibrary from './components/TemplateLibrary.jsx'

export default function App() {
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'en')
  const [view, setView] = useState('dashboard')
  const [projects, setProjects] = useState([])
  const [tasks, setTasks] = useState([])
  const [stats, setStats] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [showProjectForm, setShowProjectForm] = useState(false)
  const [editingProject, setEditingProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('sidebarCollapsed') === '1')
  const [toasts, setToasts] = useState([])
  const [showCmdPalette, setShowCmdPalette] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const toastId = useRef(0)
  // Shown when the API answers 401. Before 2026-09-03 only /api/admin/* was protected,
  // so the main app never met a 401 and had no way to ask for a token — the token box
  // lived inside AdminDashboard, which the user could only reach if the app had already
  // loaded. Locking the data routes without this would have been a blank screen.
  const [authError, setAuthError] = useState(false)
  const [tokenInput, setTokenInput] = useState('')

  const switchLang = (l) => { setLang(l); localStorage.setItem('lang', l) }
  const t = T[lang]

  const addToast = useCallback((msg, type = 'success') => {
    const id = ++toastId.current
    setToasts(prev => [...prev, { id, msg, type }])
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), 2500)
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(c => {
      const next = !c
      localStorage.setItem('sidebarCollapsed', next ? '1' : '0')
      return next
    })
  }, [])

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowCmdPalette(p => !p) }
      if (e.key === 'Escape') setShowCmdPalette(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const loadData = useCallback(async () => {
    try {
      const [ps, ts, st] = await Promise.all([api.getProjects(), api.getTasks(''), api.getDashboard()])
      setProjects(ps)
      setTasks(ts)
      setStats(st)
      setAuthError(false)
      setLoading(false)
    } catch (err) {
      // A rejected Promise.all used to leave `loading` true forever, which renders as a
      // permanent spinner — the same shape whether the token is missing or the server is
      // down. Separate them: 401 asks for the token, anything else stops the spinner.
      if (err?.status === 401) { setAuthError(true); setLoading(false); return }
      setLoading(false)
      throw err
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (selectedId) api.getNotes(selectedId).then(setNotes)
  }, [selectedId])

  // Poll every 3s while any task has an agent running — targeted: only fetches running tasks
  const hasRunningAgents = tasks.some(t => t.agentStatus === 'running')
  useEffect(() => {
    if (!hasRunningAgents) return
    const id = setInterval(async () => {
      const running = await api.getRunningTasks()
      if (running.length === 0) {
        // All agents finished — full refresh once to pick up final statuses
        const ts = await api.getTasks('')
        setTasks(ts)
      } else {
        // Merge updated running tasks into state, leave everything else untouched
        setTasks(prev => {
          const map = new Map(running.map(t => [t.id, t]))
          return prev.map(t => map.has(t.id) ? map.get(t.id) : t)
        })
      }
    }, 3000)
    return () => clearInterval(id)
  }, [hasRunningAgents])

  const selectProject = (id) => { setSelectedId(id); setView('project') }

  const handleCreateProject = async (data) => {
    const p = await api.createProject(data)
    setProjects(prev => [p, ...prev])
    setStats(s => s ? { ...s, totalProjects: s.totalProjects + 1, activeProjects: s.activeProjects + (data.status === 'active' ? 1 : 0) } : s)
    setShowProjectForm(false)
    selectProject(p.id)
  }

  const handleUpdateProject = async (id, data) => {
    const p = await api.updateProject(id, data)
    setProjects(prev => prev.map(x => x.id === id ? p : x))
    setEditingProject(null)
  }

  const handleDeleteProject = (id) => { setDeleteConfirmId(id) }

  const doDeleteProject = async () => {
    const id = deleteConfirmId
    setDeleteConfirmId(null)
    await api.deleteProject(id)
    setProjects(prev => prev.filter(x => x.id !== id))
    setTasks(prev => prev.filter(tk => tk.projectId !== id))
    setView('dashboard')
    setSelectedId(null)
    loadData()
    addToast(t.toastProjectDeleted)
  }

  const handleCreateTask = async (data) => {
    const tk = await api.createTask(data)
    setTasks(prev => [...prev, tk])
    addToast(t.toastTaskCreated)
    return tk
  }

  const handleUpdateTask = async (id, data) => {
    // Optimistic update — apply locally before API confirms
    const { _lang, ...optimistic } = data
    setTasks(prev => prev.map(x => x.id === id ? { ...x, ...optimistic } : x))
    try {
      const tk = await api.updateTask(id, data)
      setTasks(prev => prev.map(x => x.id === id ? tk : x))
      return tk
    } catch (err) {
      // Revert on failure
      api.getTasks('').then(setTasks)
      throw err
    }
  }

  const handleDeleteTask = async (id) => {
    await api.deleteTask(id)
    setTasks(prev => prev.filter(x => x.id !== id))
    addToast(t.toastTaskDeleted)
  }

  const handleCreateNote = async (content, aiExtracted = []) => {
    const n = await api.createNote({ projectId: selectedId, content, aiExtracted })
    setNotes(prev => [n, ...prev])
    addToast(t.toastNoteSaved, 'info')
    return n
  }

  const handleDeleteNote = async (id) => {
    await api.deleteNote(id)
    setNotes(prev => prev.filter(n => n.id !== id))
    addToast(t.toastNoteDeleted)
  }

  const handleRetryAgent = async (id) => {
    const tk = await api.retryAgent(id, lang)
    setTasks(prev => prev.map(x => x.id === id ? tk : x))
    return tk
  }

  const handleBulkCreateTasks = async (tasksData, projectId) => {
    const created = await Promise.all(tasksData.map(tk => api.createTask({ ...tk, projectId })))
    setTasks(prev => [...prev, ...created])
    addToast(t.toastTasksApplied(created.length))
    return created
  }

  const handleQuickStart = (project, tasks) => {
    setProjects(prev => [project, ...prev])
    setTasks(prev => [...prev, ...tasks])
    setStats(s => s ? { ...s, totalProjects: s.totalProjects + 1, activeProjects: s.activeProjects + 1 } : s)
    selectProject(project.id)
  }

  const selectedProject = projects.find(p => p.id === selectedId)
  const projectTasks = tasks.filter(t => t.projectId === selectedId)

  if (loading) return <div className="loading">{T[lang].loading}</div>

  return (
    <LangContext.Provider value={{ lang, setLang: switchLang, t }}>
    {authError && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(10,10,18,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <form
          onSubmit={(e) => { e.preventDefault(); adminAuth.set(tokenInput.trim()); setTokenInput(''); setAuthError(false); setLoading(true); loadData() }}
          style={{ background: '#14141f', border: '1px solid #2a2a3a', borderRadius: 12, padding: 24, width: 340 }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: '#e8e8f0' }}>需要 admin token</div>
          <div style={{ fontSize: 12, color: '#8a8a9a', marginBottom: 14, lineHeight: 1.5 }}>
            伺服器上的 <code>ADMIN_TOKEN</code>。只存在這個瀏覽器分頁（sessionStorage）。
          </div>
          <input
            type="password" autoFocus value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="admin token…"
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #2a2a3a', background: '#0d0d16', color: '#e8e8f0', fontSize: 13, marginBottom: 12, boxSizing: 'border-box' }}
          />
          <button type="submit" disabled={!tokenInput.trim()}
            style={{ width: '100%', padding: '8px 0', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: tokenInput.trim() ? 'pointer' : 'not-allowed', opacity: tokenInput.trim() ? 1 : 0.5 }}>
            連線
          </button>
        </form>
      </div>
    )}
    <div className="app" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <Sidebar
        projects={projects}
        selectedId={selectedId}
        onSelect={selectProject}
        onDashboard={() => setView('dashboard')}
        onAdmin={() => setView('admin')}
        onMarketing={() => setView('marketing')}
        onDecisions={() => setView('decisions')}
        onPortfolio={() => setView('portfolio')}
        onTemplates={() => setView('templates')}
        onNewProject={() => { setEditingProject(null); setShowProjectForm(true) }}
        view={view}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
      />

      <div className="main">
        {view === 'admin' && (
          <AdminDashboard onBack={() => setView('dashboard')} />
        )}

        {view === 'marketing' && (
          <MarketingApp onBack={() => setView('dashboard')} />
        )}

        {view === 'decisions' && (
          <DecisionLog projects={projects} />
        )}

        {view === 'portfolio' && (
          <Portfolio projects={projects} onSelectProject={selectProject} />
        )}

        {view === 'templates' && (
          <TemplateLibrary />
        )}

        {view === 'dashboard' && (
          <Dashboard
            stats={stats}
            projects={projects}
            tasks={tasks}
            onSelectProject={selectProject}
            onNewProject={() => setShowProjectForm(true)}
            onQuickStart={handleQuickStart}
          />
        )}

        {view === 'project' && selectedProject && (
          <ProjectDetail
            project={selectedProject}
            tasks={projectTasks}
            allTasks={tasks}
            allProjects={projects}
            notes={notes}
            onUpdateProject={(data) => handleUpdateProject(selectedProject.id, data)}
            onDeleteProject={() => handleDeleteProject(selectedProject.id)}
            onEditProject={() => setEditingProject(selectedProject)}
            onCreateTask={handleCreateTask}
            onUpdateTask={handleUpdateTask}
            onDeleteTask={handleDeleteTask}
            onBulkCreateTasks={(ts) => handleBulkCreateTasks(ts, selectedProject.id)}
            onCreateNote={handleCreateNote}
            onDeleteNote={handleDeleteNote}
            onRetryAgent={handleRetryAgent}
          />
        )}
      </div>

      {(showProjectForm || editingProject) && (
        <ProjectForm
          project={editingProject}
          onSave={editingProject
            ? (data) => handleUpdateProject(editingProject.id, data)
            : handleCreateProject
          }
          onClose={() => { setShowProjectForm(false); setEditingProject(null) }}
        />
      )}

      {showCmdPalette && (
        <CommandPalette
          projects={projects}
          tasks={tasks}
          onSelectProject={(id) => { selectProject(id); setShowCmdPalette(false) }}
          onNewProject={() => { setShowProjectForm(true); setShowCmdPalette(false) }}
          onClose={() => setShowCmdPalette(false)}
        />
      )}

      {deleteConfirmId && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '24px 28px', maxWidth: 340, width: '90%', boxShadow: '0 4px 24px rgba(0,0,0,0.18)' }}>
            <p style={{ margin: '0 0 18px', color: '#374151', fontWeight: 500, fontSize: 14 }}>{t.deleteConfirm}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setDeleteConfirmId(null)} style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', color: '#374151', fontSize: 13 }}>取消</button>
              <button onClick={doDeleteProject} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>刪除</button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            {toast.type === 'success' && '✓ '}
            {toast.type === 'error' && '✕ '}
            {toast.type === 'info' && '· '}
            {toast.msg}
          </div>
        ))}
      </div>
    </div>
    </LangContext.Provider>
  )
}
