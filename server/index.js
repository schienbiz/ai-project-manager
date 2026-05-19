import { execSync } from 'child_process'
import { fetch as undiciFetch, Agent } from 'undici'
import express from 'express'
import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import cors from 'cors'
import dotenv from 'dotenv'

dotenv.config()

// macOS system certs fix (same pattern as other chusMBp apps)
let customFetch
try {
  const ca = execSync(
    'security export -t certs -f pemseq -k /System/Library/Keychains/SystemRootCertificates.keychain 2>/dev/null',
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  )
  if (ca.trim()) {
    const agent = new Agent({ connect: { ca, rejectUnauthorized: false } })
    customFetch = (url, init) => undiciFetch(url, { ...init, dispatcher: agent })
  }
} catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()

// ── AI Providers ──────────────────────────────────────────────────────────────
const PROVIDERS = [
  {
    name: 'Groq',
    key: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    timeout: 8_000,
    fetch: customFetch,
  },
  {
    name: 'Cerebras',
    key: process.env.CEREBRAS_API_KEY,
    baseURL: 'https://api.cerebras.ai/v1',
    model: 'gpt-oss-120b',
    timeout: 12_000,
    fetch: customFetch,
  },
  {
    name: 'NVIDIA',
    key: process.env.NVIDIA_API_KEY,
    baseURL: 'https://integrate.api.nvidia.com/v1',
    model: 'meta/llama-3.3-70b-instruct',
    timeout: 20_000,
    fetch: customFetch,
  },
  {
    name: 'OpenRouter',
    key: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-v4-flash:free',
    timeout: 25_000,
    fetch: customFetch,
  },
]

function makeClient(p) {
  return new OpenAI({
    apiKey: p.key,
    baseURL: p.baseURL,
    maxRetries: 0,
    ...(p.fetch ? { fetch: p.fetch } : {}),
  })
}

async function tryProvider(p, messages, maxTokens) {
  if (!p.key) return null
  const client = makeClient(p)
  let done = false
  try {
    return await Promise.race([
      (async () => {
        const res = await client.chat.completions.create({
          model: p.model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.7,
          stream: false,
        })
        done = true
        return res.choices[0]?.message?.content?.trim() || null
      })(),
      new Promise(resolve => setTimeout(() => {
        if (!done) console.warn(`[ai] ${p.name} timed out after ${p.timeout}ms`)
        resolve(null)
      }, p.timeout)),
    ])
  } catch (err) {
    done = true
    console.warn(`[ai] ${p.name} failed: ${err.message?.slice(0, 80)}`)
    return null
  }
}

const MULTI_MAX_MS = 13_000
const DRAFT_MAX_TOKENS = 600

async function multiGenerate(messages, maxTokens = 2048) {
  const successes = []
  const tasks = PROVIDERS
    .filter(p => p.key)
    .map(p => tryProvider(p, messages, DRAFT_MAX_TOKENS).then(result => {
      if (result) successes.push(result)
      return result
    }))

  await Promise.race([
    Promise.allSettled(tasks),
    new Promise(resolve => setTimeout(resolve, MULTI_MAX_MS)),
  ])

  if (successes.length === 0) {
    for (const p of PROVIDERS) {
      const text = await tryProvider(p, messages, maxTokens)
      if (text) return text
    }
    throw new Error('All AI providers failed')
  }

  if (successes.length === 1) return successes[0]

  console.log(`[ai] synthesizing from ${successes.length} models`)
  const userMsg = [...messages].reverse().find(m => m.role === 'user')?.content ?? ''
  const systemMsg = messages.find(m => m.role === 'system')?.content ?? ''
  const drafts = successes.map((s, i) => `[Draft ${i + 1}]\n${s}`).join('\n\n')

  const synthMessages = [
    { role: 'system', content: systemMsg },
    {
      role: 'user',
      content: `${userMsg}\n\n---\nYou received ${successes.length} drafts from different AI models. Synthesize the best elements into a single optimal response. Output only the final answer, no meta-commentary.\n\n${drafts}`,
    },
  ]

  for (const p of PROVIDERS) {
    const synth = await tryProvider(p, synthMessages, maxTokens)
    if (synth) { console.log(`[ai] synthesis via ${p.name}`); return synth }
  }

  return successes[0]
}

async function streamGenerate(res, system, userPrompt, maxTokens = 2048) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    const text = await multiGenerate([
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ], maxTokens)

    const CHUNK = 12
    for (let i = 0; i < text.length; i += CHUNK) {
      res.write(`data: ${JSON.stringify({ text: text.slice(i, i + CHUNK) })}\n\n`)
    }
    res.write('data: [DONE]\n\n')
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    res.write('data: [DONE]\n\n')
  }
  res.end()
}

// ── Data helpers ──────────────────────────────────────────────────────────────
app.use(cors())
app.use(express.json({ limit: '2mb' }))

const DATA_DIR = path.join(__dirname, '../data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json')
const TASKS_FILE    = path.join(DATA_DIR, 'tasks.json')
const NOTES_FILE    = path.join(DATA_DIR, 'notes.json')

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return fallback }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

const now = () => new Date().toISOString()
const uid = () => randomUUID()

// ── Projects ──────────────────────────────────────────────────────────────────
app.get('/api/projects', (req, res) => res.json(readJSON(PROJECTS_FILE, [])))

app.post('/api/projects', (req, res) => {
  const list = readJSON(PROJECTS_FILE, [])
  const item = {
    id: uid(),
    name: req.body.name || 'Untitled Project',
    description: req.body.description || '',
    goal: req.body.goal || '',
    status: req.body.status || 'active',
    priority: req.body.priority || 'medium',
    startDate: req.body.startDate || null,
    dueDate: req.body.dueDate || null,
    tags: req.body.tags || [],
    createdAt: now(),
    updatedAt: now(),
  }
  list.unshift(item)
  writeJSON(PROJECTS_FILE, list)
  res.json(item)
})

app.get('/api/projects/:id', (req, res) => {
  const project = readJSON(PROJECTS_FILE, []).find(p => p.id === req.params.id)
  if (!project) return res.status(404).json({ error: 'Not found' })
  res.json(project)
})

app.put('/api/projects/:id', (req, res) => {
  const list = readJSON(PROJECTS_FILE, [])
  const idx = list.findIndex(p => p.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  list[idx] = { ...list[idx], ...req.body, id: req.params.id, updatedAt: now() }
  writeJSON(PROJECTS_FILE, list)
  res.json(list[idx])
})

app.delete('/api/projects/:id', (req, res) => {
  writeJSON(PROJECTS_FILE, readJSON(PROJECTS_FILE, []).filter(p => p.id !== req.params.id))
  writeJSON(TASKS_FILE, readJSON(TASKS_FILE, []).filter(t => t.projectId !== req.params.id))
  writeJSON(NOTES_FILE, readJSON(NOTES_FILE, []).filter(n => n.projectId !== req.params.id))
  res.json({ ok: true })
})

// ── Tasks ─────────────────────────────────────────────────────────────────────
app.get('/api/tasks', (req, res) => {
  const all = readJSON(TASKS_FILE, [])
  res.json(req.query.projectId ? all.filter(t => t.projectId === req.query.projectId) : all)
})

app.post('/api/tasks', (req, res) => {
  const list = readJSON(TASKS_FILE, [])
  const item = {
    id: uid(),
    projectId: req.body.projectId,
    title: req.body.title || 'Untitled Task',
    description: req.body.description || '',
    status: req.body.status || 'todo',
    priority: req.body.priority || 'medium',
    estimatedHours: req.body.estimatedHours ?? null,
    actualHours: req.body.actualHours ?? null,
    dueDate: req.body.dueDate || null,
    assignee: req.body.assignee || '',
    tags: req.body.tags || [],
    sortOrder: list.filter(t => t.projectId === req.body.projectId).length,
    createdAt: now(),
    updatedAt: now(),
  }
  list.push(item)
  writeJSON(TASKS_FILE, list)
  res.json(item)
})

app.put('/api/tasks/bulk', (req, res) => {
  const updates = req.body
  const list = readJSON(TASKS_FILE, [])
  for (const u of updates) {
    const idx = list.findIndex(t => t.id === u.id)
    if (idx !== -1) list[idx] = { ...list[idx], ...u, updatedAt: now() }
  }
  writeJSON(TASKS_FILE, list)
  res.json({ ok: true })
})

app.put('/api/tasks/:id', (req, res) => {
  const list = readJSON(TASKS_FILE, [])
  const idx = list.findIndex(t => t.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  list[idx] = { ...list[idx], ...req.body, id: req.params.id, updatedAt: now() }
  writeJSON(TASKS_FILE, list)
  res.json(list[idx])
})

app.delete('/api/tasks/:id', (req, res) => {
  writeJSON(TASKS_FILE, readJSON(TASKS_FILE, []).filter(t => t.id !== req.params.id))
  res.json({ ok: true })
})

// ── Notes ─────────────────────────────────────────────────────────────────────
app.get('/api/notes', (req, res) => {
  const all = readJSON(NOTES_FILE, [])
  res.json(req.query.projectId ? all.filter(n => n.projectId === req.query.projectId) : all)
})

app.post('/api/notes', (req, res) => {
  const list = readJSON(NOTES_FILE, [])
  const item = {
    id: uid(),
    projectId: req.body.projectId,
    content: req.body.content || '',
    aiExtracted: req.body.aiExtracted || [],
    createdAt: now(),
  }
  list.unshift(item)
  writeJSON(NOTES_FILE, list)
  res.json(item)
})

app.delete('/api/notes/:id', (req, res) => {
  writeJSON(NOTES_FILE, readJSON(NOTES_FILE, []).filter(n => n.id !== req.params.id))
  res.json({ ok: true })
})

// ── Dashboard stats ───────────────────────────────────────────────────────────
app.get('/api/dashboard', (req, res) => {
  const projects = readJSON(PROJECTS_FILE, [])
  const tasks    = readJSON(TASKS_FILE, [])
  const today    = new Date().toISOString().split('T')[0]
  const in7days  = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]

  res.json({
    totalProjects:    projects.length,
    activeProjects:   projects.filter(p => p.status === 'active').length,
    completedProjects:projects.filter(p => p.status === 'completed').length,
    totalTasks:       tasks.length,
    todoTasks:        tasks.filter(t => t.status === 'todo').length,
    inProgressTasks:  tasks.filter(t => t.status === 'in_progress').length,
    reviewTasks:      tasks.filter(t => t.status === 'review').length,
    doneTasks:        tasks.filter(t => t.status === 'done').length,
    blockedTasks:     tasks.filter(t => t.status === 'blocked').length,
    overdueTasks:     tasks.filter(t => t.dueDate && t.dueDate < today && t.status !== 'done').length,
    upcomingProjects: projects
      .filter(p => p.dueDate && p.dueDate >= today && p.dueDate <= in7days && p.status === 'active')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    recentProjects: projects.slice(0, 5),
  })
})

// ── AI system prompt ──────────────────────────────────────────────────────────
const PM_SYSTEM = `You are an expert AI project manager with 15 years of experience in software engineering, agile, and product strategy. You help teams plan, execute, and track projects with clarity. Be specific, actionable, and concise. Today's date: ${new Date().toISOString().split('T')[0]}.`

// Generate full project plan as JSON task array
app.post('/api/ai/generate-plan', async (req, res) => {
  const { projectName, description, goal, dueDate, teamSize } = req.body
  const prompt = `Generate a detailed project plan as a JSON array of tasks.

Project: ${projectName}
Description: ${description || 'Not provided'}
Goal: ${goal || 'Not specified'}
Due Date: ${dueDate || 'Not specified'}
Team Size: ${teamSize || 'Not specified'}

Return ONLY a valid JSON array. Each task object must have exactly these fields:
- "title": string (start with an action verb, concise)
- "description": string (1-2 sentences of context)
- "priority": "low" | "medium" | "high" | "urgent"
- "estimatedHours": number
- "status": "todo"
- "dueDate": "YYYY-MM-DD" or null

Generate 8-15 tasks covering the full project lifecycle in logical order. Return only the JSON array, no markdown, no explanation.`

  await streamGenerate(res, PM_SYSTEM, prompt, 2000)
})

// Daily standup summary
app.post('/api/ai/standup', async (req, res) => {
  const { project, tasks } = req.body
  const done       = tasks.filter(t => t.status === 'done').map(t => t.title)
  const inProgress = tasks.filter(t => t.status === 'in_progress').map(t => t.title)
  const blocked    = tasks.filter(t => t.status === 'blocked').map(t => t.title)
  const upcoming   = tasks.filter(t => t.status === 'todo').slice(0, 4).map(t => t.title)

  const prompt = `Write a concise daily standup update for this project.

Project: ${project.name}
Goal: ${project.goal || 'Not specified'}
Due: ${project.dueDate || 'Not set'}

✅ Done: ${done.join(', ') || 'Nothing yet'}
🔄 In Progress: ${inProgress.join(', ') || 'None'}
🚧 Blocked: ${blocked.join(', ') || 'None'}
📋 Up Next: ${upcoming.join(', ') || 'None'}

Format:
**Yesterday:** [what was completed]
**Today:** [what will be worked on]
**Blockers:** [blockers or "None"]
**Overall Status:** [On Track / At Risk / Delayed] — [one sentence]`

  await streamGenerate(res, PM_SYSTEM, prompt, 400)
})

// Risk analysis
app.post('/api/ai/risks', async (req, res) => {
  const { project, tasks } = req.body
  const today   = new Date().toISOString().split('T')[0]
  const overdue = tasks.filter(t => t.dueDate && t.dueDate < today && t.status !== 'done')
  const blocked = tasks.filter(t => t.status === 'blocked')
  const done    = tasks.filter(t => t.status === 'done').length
  const total   = tasks.length

  const prompt = `Analyze project risks and provide actionable recommendations.

Project: ${project.name}
Goal: ${project.goal || 'Not specified'}
Due Date: ${project.dueDate || 'Not set'} | Today: ${today}
Progress: ${done}/${total} tasks done (${total ? Math.round(done/total*100) : 0}%)

Overdue tasks: ${overdue.map(t => t.title).join(', ') || 'None'}
Blocked tasks: ${blocked.map(t => `${t.title}${t.description ? ': ' + t.description : ''}`).join('; ') || 'None'}
In Progress: ${tasks.filter(t => t.status === 'in_progress').map(t => t.title).join(', ') || 'None'}

Provide:
**Risk Level:** Low / Medium / High / Critical
**Top Risks:** (list 3 specific risks with impact)
**Immediate Actions:** (3-5 concrete steps to take this week)
**Timeline Assessment:** Will this project meet its deadline?`

  await streamGenerate(res, PM_SYSTEM, prompt, 700)
})

// Weekly report across all projects
app.post('/api/ai/weekly-report', async (req, res) => {
  const { projects, tasks } = req.body
  const today = new Date().toISOString().split('T')[0]

  const summaries = projects.map(p => {
    const pt   = tasks.filter(t => t.projectId === p.id)
    const done  = pt.filter(t => t.status === 'done').length
    const total = pt.length
    const overdue = pt.filter(t => t.dueDate && t.dueDate < today && t.status !== 'done').length
    return `- ${p.name} [${p.status}]: ${done}/${total} tasks, ${overdue} overdue, due ${p.dueDate || 'N/A'}`
  }).join('\n')

  const prompt = `Generate a professional weekly project status report.

Projects:
${summaries || 'No projects'}

Overall: ${tasks.filter(t => t.status === 'done').length} done, ${tasks.filter(t => t.status === 'in_progress').length} in progress, ${tasks.filter(t => t.status === 'blocked').length} blocked

Write a professional weekly report:
**Executive Summary** (2-3 sentences)
**Project Progress** (one bullet per project with status)
**Wins This Week**
**Risks & Blockers**
**Next Week Priorities**`

  await streamGenerate(res, PM_SYSTEM, prompt, 1200)
})

// Parse meeting notes → extract tasks as JSON
app.post('/api/ai/parse-notes', async (req, res) => {
  const { content, projectName } = req.body

  const prompt = `Extract all action items from these meeting notes as a JSON array.

Project: ${projectName || 'General'}

Meeting Notes:
${content}

Return ONLY a valid JSON array. Each item must have:
- "title": string (action verb + what, concise)
- "description": string (context from notes)
- "priority": "low" | "medium" | "high" | "urgent"
- "estimatedHours": number (your best estimate)
- "status": "todo"
- "assignee": string (name if mentioned, else "")
- "dueDate": "YYYY-MM-DD" or null

Extract every concrete action, decision, or commitment. Return only the JSON array.`

  await streamGenerate(res, PM_SYSTEM, prompt, 1500)
})

// Quick task estimation (non-streaming JSON)
app.post('/api/ai/estimate', async (req, res) => {
  const { title, description, projectContext } = req.body
  try {
    const text = await multiGenerate([
      { role: 'system', content: PM_SYSTEM },
      { role: 'user', content: `Estimate the effort for this task. Return ONLY a JSON object:
{
  "hours": number,
  "confidence": "low" | "medium" | "high",
  "rationale": "one sentence",
  "subtasks": ["step 1", "step 2", ...]
}

Task: ${title}
Details: ${description || 'None'}
Project context: ${projectContext || 'Software project'}

Return only JSON.` },
    ], 300)

    const match = text.match(/\{[\s\S]*\}/)
    res.json(match ? JSON.parse(match[0]) : { hours: null, confidence: 'low', rationale: text, subtasks: [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Provider status check ─────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    providers: PROVIDERS.map(p => ({ name: p.name, configured: !!p.key, model: p.model })),
    dataDir: DATA_DIR,
    projects: readJSON(PROJECTS_FILE, []).length,
    tasks: readJSON(TASKS_FILE, []).length,
  })
})

// ── Frontend (production) ─────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(__dirname, '../dist')
  app.use(express.static(distDir))
  app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

const PORT = process.env.PORT || 3004
app.listen(PORT, () => console.log(`[ai-pm] started on port ${PORT}`))
