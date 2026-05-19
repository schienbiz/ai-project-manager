import { useState, useEffect, useCallback } from 'react'
import { api } from './api.js'
import Sidebar from './components/Sidebar.jsx'
import Dashboard from './components/Dashboard.jsx'
import ProjectDetail from './components/ProjectDetail.jsx'
import ProjectForm from './components/ProjectForm.jsx'

export default function App() {
  const [view, setView] = useState('dashboard')
  const [projects, setProjects] = useState([])
  const [tasks, setTasks] = useState([])
  const [stats, setStats] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [showProjectForm, setShowProjectForm] = useState(false)
  const [editingProject, setEditingProject] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    const [ps, ts, st] = await Promise.all([api.getProjects(), api.getTasks(''), api.getDashboard()])
    setProjects(ps)
    setTasks(ts)
    setStats(st)
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

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
    if (!confirm('Delete this project and all its tasks?')) return
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

  const handleBulkCreateTasks = async (tasksData, projectId) => {
    const created = []
    for (const t of tasksData) {
      const task = await api.createTask({ ...t, projectId })
      created.push(task)
    }
    setTasks(prev => [...prev, ...created])
    return created
  }

  const selectedProject = projects.find(p => p.id === selectedId)
  const projectTasks = tasks.filter(t => t.projectId === selectedId)

  if (loading) return <div className="loading">Loading...</div>

  return (
    <div className="app">
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
          />
        )}

        {view === 'project' && selectedProject && (
          <ProjectDetail
            project={selectedProject}
            tasks={projectTasks}
            allTasks={tasks}
            onUpdateProject={(data) => handleUpdateProject(selectedProject.id, data)}
            onDeleteProject={() => handleDeleteProject(selectedProject.id)}
            onEditProject={() => setEditingProject(selectedProject)}
            onCreateTask={handleCreateTask}
            onUpdateTask={handleUpdateTask}
            onDeleteTask={handleDeleteTask}
            onBulkCreateTasks={(ts) => handleBulkCreateTasks(ts, selectedProject.id)}
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
  )
}
