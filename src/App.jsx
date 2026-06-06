import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from './api.js'
import { LangContext, T } from './i18n.js'
import Sidebar from './components/Sidebar.jsx'
import Dashboard from './components/Dashboard.jsx'
import ProjectDetail from './components/ProjectDetail.jsx'
import ProjectForm from './components/ProjectForm.jsx'
import AdminDashboard from './components/AdminDashboard.jsx'
import CommandPalette from './components/CommandPalette.jsx'

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
  const toastId = useRef(0)

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
    const [ps, ts, st] = await Promise.all([api.getProjects(), api.getTasks(''), api.getDashboard()])
    setProjects(ps)
    setTasks(ts)
    setStats(st)
    setLoading(false)
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

  const handleDeleteProject = async (id) => {
    if (!confirm(t.deleteConfirm)) return
    await api.deleteProject(id)
    setProjects(prev => prev.filter(x => x.id !== id))
    setTasks(prev => prev.filter(t => t.projectId !== id))
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
    <div className="app" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <Sidebar
        projects={projects}
        selectedId={selectedId}
        onSelect={selectProject}
        onDashboard={() => setView('dashboard')}
        onAdmin={() => setView('admin')}
        onNewProject={() => { setEditingProject(null); setShowProjectForm(true) }}
        view={view}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
      />

      <div className="main">
        {view === 'admin' && (
          <AdminDashboard onBack={() => setView('dashboard')} />
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
