// ── Admin auth token (stored in sessionStorage, never in bundle) ──────────────
const ADMIN_TOKEN_KEY = 'admin_token'
export const adminAuth = {
  get:   () => { try { return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '' } catch { return '' } },
  set:   (t) => { try { sessionStorage.setItem(ADMIN_TOKEN_KEY, t) } catch {} },
  clear: () => { try { sessionStorage.removeItem(ADMIN_TOKEN_KEY) } catch {} },
}
function adminHeaders(extra = {}) {
  return { 'Content-Type': 'application/json', 'x-admin-token': adminAuth.get(), ...extra }
}

/**
 * Every request carries the token, and a 401 is a TYPE the caller can branch on.
 *
 * Until 2026-09-03 only the twelve /api/admin/* calls sent it; the other thirty-five —
 * every project, task, note, risk, decision and /api/ai/* call — went out bare, because
 * the server did not ask. It does now, so a bare request is a 401 and a caller that
 * cannot tell a 401 from a network error would render an empty dashboard instead of
 * asking for the token.
 */
function unauthorized() {
  return Object.assign(new Error('Unauthorized'), { status: 401 })
}
async function req(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'x-admin-token': adminAuth.get(), ...(init.headers || {}) } })
  if (res.status === 401) throw unauthorized()
  return res.json()
}
const get = (url) => req(url)
function adminGet(url) {
  return fetch(url, { headers: { 'x-admin-token': adminAuth.get() } }).then(r => {
    if (r.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 })
    return r.json()
  })
}
function adminPost(url, data) {
  return fetch(url, { method: 'POST', headers: adminHeaders(), body: JSON.stringify(data) }).then(r => {
    if (r.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 })
    return r.json()
  })
}
function adminDel(url) {
  return fetch(url, { method: 'DELETE', headers: { 'x-admin-token': adminAuth.get() } }).then(r => {
    if (r.status === 401) throw Object.assign(new Error('Unauthorized'), { status: 401 })
    return r.json()
  })
}

const json = (r) => r.json()

export const api = {
  // Dashboard
  getDashboard:    () => get('/pm/api/dashboard'),
  getPortfolio:    () => get('/pm/api/portfolio'),

  // Template Library
  getTemplates:    () => get('/pm/api/templates'),
  createTemplate:  (data) => post('/pm/api/templates', data),
  updateTemplate:  (id, data) => put(`/pm/api/templates/${id}`, data),
  deleteTemplate:  (id) => del(`/pm/api/templates/${id}`),

  // Projects
  getProjects:     () => get('/pm/api/projects'),
  getProject:      (id) => get(`/pm/api/projects/${id}`),
  createProject:   (data) => post('/pm/api/projects', data),
  quickStart:      (title, lang) => post('/pm/api/projects/quick-start', { title, lang }),
  updateProject:   (id, data) => put(`/pm/api/projects/${id}`, data),
  deleteProject:   (id) => del(`/pm/api/projects/${id}`),

  // Tasks
  getTasks:        (projectId) => get(`/pm/api/tasks?projectId=${projectId}`),
  getRunningTasks: () => get('/pm/api/tasks/running'),
  createTask:      (data) => post('/pm/api/tasks', data),
  updateTask:      (id, data) => put(`/pm/api/tasks/${id}`, data),
  deleteTask:      (id) => del(`/pm/api/tasks/${id}`),
  retryAgent:      (id, lang) => post(`/pm/api/tasks/${id}/agent/retry`, { lang }),

  // Notes
  getNotes:        (projectId) => get(`/pm/api/notes?projectId=${projectId}`),
  createNote:      (data) => post('/pm/api/notes', data),
  deleteNote:      (id) => del(`/pm/api/notes/${id}`),

  // Schedule (critical path + checks)
  getSchedule:     (projectId) => get(`/pm/api/projects/${projectId}/schedule`),
  getFlow:         (projectId) => get(`/pm/api/projects/${projectId}/flow`),

  // Risks
  getRisks:        (projectId) => get(`/pm/api/risks?projectId=${projectId}`),
  createRisk:      (data) => post('/pm/api/risks', data),
  updateRisk:      (id, data) => put(`/pm/api/risks/${id}`, data),
  deleteRisk:      (id) => del(`/pm/api/risks/${id}`),
  extractRisks:    (projectId, lang) => post('/pm/api/ai/risks-extract', { projectId, lang }),

  // Admin (all protected by x-admin-token)
  getAdminStatus:       () => adminGet('/pm/api/admin/status'),
  restartService:       (label) => adminPost('/pm/api/admin/restart', { label }),
  getVault:             () => adminGet('/pm/api/admin/vault'),
  upsertVaultKey:       (data) => adminPost('/pm/api/admin/vault', data),
  deleteVaultKey:       (name) => adminDel(`/pm/api/admin/vault/${encodeURIComponent(name)}`),
  revealVaultKey:       (name) => adminGet(`/pm/api/admin/vault/${encodeURIComponent(name)}/reveal`),
  forceRefreshRender:   () => adminPost('/pm/api/admin/render/refresh', {}),
  setRenderUsageConfig: (cfg) => adminPost('/pm/api/admin/render/usage/config', cfg),
  forceRefreshDbUsage:  () => adminPost('/pm/api/admin/db-usage/refresh', {}),
  forceRefreshCloudinary: () => adminPost('/pm/api/admin/cloudinary/refresh', {}),
  sendDigestNow:        () => adminPost('/pm/api/admin/digest/send-now', {}),

  // AI helpers
  estimateTask:     (data) => post('/pm/api/ai/estimate', data),
  translateFields:  (data) => post('/pm/api/ai/translate-fields', data),

  // Decision Log
  getDecisions:       (q = {}) => get('/pm/api/decisions?' + new URLSearchParams(q)),
  getDecision:        (id) => get(`/pm/api/decisions/${id}`),
  setDecisionOutcome: (id, data) => put(`/pm/api/decisions/${id}/outcome`, data),
  deleteDecision:     (id) => del(`/pm/api/decisions/${id}`),
  getCalibration:     (domain = '') => get('/pm/api/decisions/stats/calibration' + (domain ? `?domain=${domain}` : '')),
}

function post(url, data) {
  return req(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
}
function put(url, data) {
  return req(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
}
function del(url) {
  return req(url, { method: 'DELETE' })
}

// SSE helper for agent endpoints — separates step logs from output chunks
export async function streamAgent(endpoint, body, onStep, onChunk, onDone, onError, extraHeaders = {}) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      // Token by default rather than only when a caller remembers to pass it —
      // AgentPanel calls this without extraHeaders and would have 401'd silently.
      headers: { 'Content-Type': 'application/json', 'x-admin-token': adminAuth.get(), ...extraHeaders },
      body: JSON.stringify(body),
    })
    if (res.status === 401) { onError?.('Unauthorized'); return }

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
      headers: { 'Content-Type': 'application/json', 'x-admin-token': adminAuth.get() },
      body: JSON.stringify(body),
    })
    // streamAI had no 401 branch at all: an unauthenticated call fell through to
    // res.body.getReader() and threw a TypeError the user saw as a broken stream.
    if (res.status === 401) { onError?.('Unauthorized'); return }

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
