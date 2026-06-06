const json = (r) => r.json()

export const api = {
  // Dashboard
  getDashboard:    () => fetch('/pm/api/dashboard').then(json),
  getStatus:       () => fetch('/pm/api/status').then(json),

  // Projects
  getProjects:     () => fetch('/pm/api/projects').then(json),
  getProject:      (id) => fetch(`/pm/api/projects/${id}`).then(json),
  createProject:   (data) => post('/pm/api/projects', data),
  quickStart:      (title, lang) => post('/pm/api/projects/quick-start', { title, lang }),
  updateProject:   (id, data) => put(`/pm/api/projects/${id}`, data),
  deleteProject:   (id) => del(`/pm/api/projects/${id}`),

  // Tasks
  getTasks:        (projectId) => fetch(`/pm/api/tasks?projectId=${projectId}`).then(json),
  getRunningTasks: () => fetch('/pm/api/tasks/running').then(json),
  createTask:      (data) => post('/pm/api/tasks', data),
  updateTask:      (id, data) => put(`/pm/api/tasks/${id}`, data),
  bulkUpdateTasks: (updates) => put('/pm/api/tasks/bulk', updates),
  deleteTask:      (id) => del(`/pm/api/tasks/${id}`),
  retryAgent:      (id, lang) => post(`/pm/api/tasks/${id}/agent/retry`, { lang }),

  // Notes
  getNotes:        (projectId) => fetch(`/pm/api/notes?projectId=${projectId}`).then(json),
  createNote:      (data) => post('/pm/api/notes', data),
  deleteNote:      (id) => del(`/pm/api/notes/${id}`),

  // Admin
  getAdminStatus:  () => fetch('/pm/api/admin/status').then(json),
  restartService:  (label) => post('/pm/api/admin/restart', { label }),

  // AI helpers
  estimateTask:     (data) => post('/pm/api/ai/estimate', data),
  translateFields:  (data) => post('/pm/api/ai/translate-fields', data),
}

function post(url, data) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json)
}
function put(url, data) {
  return fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(json)
}
function del(url) {
  return fetch(url, { method: 'DELETE' }).then(json)
}

// SSE helper for agent endpoints — separates step logs from output chunks
export async function streamAgent(endpoint, body, onStep, onChunk, onDone, onError) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data === '[DONE]') { onDone?.(); return }
        try {
          const parsed = JSON.parse(data)
          if (parsed.type === 'step')   onStep?.(parsed.text)
          else if (parsed.type === 'output') onChunk?.(parsed.text)
          if (parsed.error) { onError?.(parsed.error); return }
        } catch {}
      }
    }
    onDone?.()
  } catch (err) {
    onError?.(err.message)
  }
}

// SSE streaming helper for AI endpoints
export async function streamAI(endpoint, body, onChunk, onDone, onError) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop()

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data === '[DONE]') { onDone?.(); return }
        try {
          const parsed = JSON.parse(data)
          if (parsed.text) onChunk(parsed.text)
          if (parsed.error) { onError?.(parsed.error); return }
        } catch {}
      }
    }
    onDone?.()
  } catch (err) {
    onError?.(err.message)
  }
}
