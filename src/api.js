const json = (r) => r.json()

export const api = {
  // Dashboard
  getDashboard:    () => fetch('/api/dashboard').then(json),
  getStatus:       () => fetch('/api/status').then(json),

  // Projects
  getProjects:     () => fetch('/api/projects').then(json),
  getProject:      (id) => fetch(`/api/projects/${id}`).then(json),
  createProject:   (data) => post('/api/projects', data),
  updateProject:   (id, data) => put(`/api/projects/${id}`, data),
  deleteProject:   (id) => del(`/api/projects/${id}`),

  // Tasks
  getTasks:        (projectId) => fetch(`/api/tasks?projectId=${projectId}`).then(json),
  createTask:      (data) => post('/api/tasks', data),
  updateTask:      (id, data) => put(`/api/tasks/${id}`, data),
  bulkUpdateTasks: (updates) => put('/api/tasks/bulk', updates),
  deleteTask:      (id) => del(`/api/tasks/${id}`),

  // Notes
  getNotes:        (projectId) => fetch(`/api/notes?projectId=${projectId}`).then(json),
  createNote:      (data) => post('/api/notes', data),
  deleteNote:      (id) => del(`/api/notes/${id}`),
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
