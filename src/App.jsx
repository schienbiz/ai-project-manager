import { useState, useEffect, useCallback } from 'react'
import { api } from './api.js'
import { LangContext, T } from './i18n.js'
import Sidebar from './components/Sidebar.jsx'
import Dashboard from './components/Dashboard.jsx'
import ProjectDetail from './components/ProjectDetail.jsx'
import ProjectForm from './components/ProjectForm.jsx'

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

  const switchLang = (l) => { setLang(l); localStorage.setItem('lang', l) }
  const t = T[lang]

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

  // Poll every 3s while any task has an agent running in the background
  const hasRunningAgents = tasks.some(t => t.agentStatus === 'running')
  useEffect(() => {
    if (!hasRunningAgents) return
    const id = setInterval(async () => {
      const ts = await api.getTasks('')
      setTasks(ts)
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
  }

  const handleCreateTask = async (data) => {
    const t = await api.createTask(data)
    setTasks(prev => [...prev, t])
    return t
  }

  const handleUpdateTask = async (id, data) => {
    const t = await api.updateTask(id, data)
    setTasks(prev => prev.map(x => x.id === id ? t : x))
    return t
  }

  const handleDeleteTask = async (id) => {
    await api.deleteTask(id)
    setTasks(prev => prev.filter(x => x.id !== id))
  }

  const handleCreateNote = async (content, aiExtracted = []) => {
    const n = await api.createNote({ projectId: selectedId, content, aiExtracted })
    setNotes(prev => [n, ...prev])
    return n
  }

  const handleDeleteNote = async (id) => {
    await api.deleteNote(id)
    setNotes(prev => prev.filter(n => n.id !== id))
  }

  const handleBulkCreateTasks = async (tasksData, projectId) => {
    const created = await Promise.all(tasksData.map(t => api.createTask({ ...t, projectId })))
    setTasks(prev => [...prev, ...created])
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
        onNewProject={() => { setEditingProject(null); setShowProjectForm(true) }}
        view={view}
      />

      <div className="main">
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
    </div>
    </LangContext.Provider>
  )
}
