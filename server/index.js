// ── SOP (auto-healing built-in) ───────────────────────────────────────────────
// Service crash        → KeepAlive:true in plist restarts automatically
// AI provider timeout  → multiGenerate() races all 3 providers, falls back sequentially
// All AI providers fail → morning digest sends a plain-text summary instead
// JSON data corruption → atomic writes (.tmp + rename) prevent partial writes
// Silent crash         → unhandledRejection + uncaughtException log to /tmp/ai-project-manager.err
//
// Manual SOP (when auto-healing isn't enough):
//  Log:       ssh chusMBp "tail -50 /tmp/ai-project-manager.log"
//  Errors:    ssh chusMBp "tail -20 /tmp/ai-project-manager.err"
//  Restart:   ssh chusMBp "launchctl kickstart -k gui/501/com.ai-project-manager.dev"
//  Status:    curl http://localhost:3004/pm/api/status
//  Digest:    curl http://localhost:3004/pm/api/ai/digest/now
//  Corrupt JSON: check data/*.tmp — rename to *.json to restore last good write
// ─────────────────────────────────────────────────────────────────────────────

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

process.on('unhandledRejection', (reason) => {
  console.error('[ai-pm] unhandledRejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[ai-pm] uncaughtException:', err.message, err.stack)
})

// ── AI Providers ──────────────────────────────────────────────────────────────
// Groq Llama + Cerebras + Groq Qwen3 (~8-11s each on LPU/wafer).
// NVIDIA removed: consistently times out at 10s in practice.
// OpenRouter removed: free tier consistently 14s, always times out.
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
    timeout: 11_000,
    fetch: customFetch,
  },
  {
    name: 'Qwen3',
    key: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'qwen/qwen3-32b',
    timeout: 10_000,
    fetch: customFetch,
    extraParams: { reasoning_effort: 'none' },
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
          ...(p.extraParams || {}),
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

async function multiGenerate(messages, maxTokens = 2048) {
  const successes = []
  const tasks = PROVIDERS
    .filter(p => p.key)
    .map(p => tryProvider(p, messages, maxTokens).then(result => {
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

// Rewrite /pm/api/* → /api/* so the app works both via proxy (/pm) and direct port access
app.use((req, res, next) => {
  if (req.url.startsWith('/pm/api/')) req.url = req.url.slice(3)
  next()
})

const DATA_DIR = path.join(__dirname, '../data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json')
const TASKS_FILE    = path.join(DATA_DIR, 'tasks.json')
const NOTES_FILE    = path.join(DATA_DIR, 'notes.json')

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return fallback }
}
function writeJSON(file, data) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
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

// Quick-start: title only → create project + AI plan + tasks in one shot (non-streaming)
app.post('/api/projects/quick-start', async (req, res) => {
  const title = req.body?.title?.trim()
  const lang  = req.body?.lang
  if (!title) return res.status(400).json({ error: 'title required' })

  // 1. Create project
  const projects = readJSON(PROJECTS_FILE, [])
  const project = {
    id: uid(), name: title, description: '', goal: '',
    status: 'active', priority: 'medium',
    startDate: null, dueDate: null, tags: [],
    createdAt: now(), updatedAt: now(),
  }
  projects.unshift(project)
  writeJSON(PROJECTS_FILE, projects)

  // 2. Generate plan via multiGenerate (non-streaming, returns string)
  const prompt = `Generate a detailed project plan as a JSON array of tasks.

Project: ${title}
Description: Not provided
Goal: Not specified
Due Date: Not specified
Team Size: Not specified

Return ONLY a valid JSON array. Each task object must have exactly these fields:
- "title": string (start with an action verb, concise)
- "description": string (1-2 sentences of context)
- "priority": "low" | "medium" | "high" | "urgent"
- "estimatedHours": number
- "status": "todo"
- "dueDate": null

Generate 8-15 tasks covering the full project lifecycle in logical order. Return only the JSON array, no markdown, no explanation.`

  let tasksData = []
  try {
    const raw = await multiGenerate([
      { role: 'system', content: getPMSystem() + getLangDirective(lang) },
      { role: 'user', content: prompt },
    ], 2000)
    const cleaned = raw?.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed)) tasksData = parsed
  } catch (e) {
    console.error('[quick-start] plan parse error:', e.message)
  }

  // 3. Bulk-create tasks
  const taskList = readJSON(TASKS_FILE, [])
  const createdTasks = tasksData.map((t, i) => ({
    id: uid(), projectId: project.id,
    title: t.title || 'Untitled Task',
    description: t.description || '',
    status: 'todo',
    priority: ['low','medium','high','urgent'].includes(t.priority) ? t.priority : 'medium',
    estimatedHours: typeof t.estimatedHours === 'number' ? t.estimatedHours : null,
    actualHours: null, dueDate: t.dueDate || null,
    assignee: '', tags: [], sortOrder: i,
    createdAt: now(), updatedAt: now(),
  }))
  taskList.push(...createdTasks)
  writeJSON(TASKS_FILE, taskList)

  console.log(`[quick-start] "${title}" → ${createdTasks.length} tasks`)
  res.json({ project, tasks: createdTasks })
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

// Background agent: same logic as /agent-run but collects output → writes to JSON
async function runAgentBackground(taskId, projectId, lang) {
  try {
    const task    = readJSON(TASKS_FILE, []).find(t => t.id === taskId)
    const project = readJSON(PROJECTS_FILE, []).find(p => p.id === projectId)
    if (!task || !project) return

    const projectTasks = readJSON(TASKS_FILE, []).filter(t => t.projectId === projectId)
    const type = await classifyTask(task.title, task.description)

    let output = ''
    const fakeRes = {
      write(data) {
        const m = data.match(/^data: (.*)\n\n$/)
        if (!m) return
        try {
          const p = JSON.parse(m[1])
          if (p.type === 'output') output += p.text
        } catch {}
      }
    }

    if      (type === 'research') await runResearcher(task, project, lang, fakeRes)
    else if (type === 'plan')     await runPlanner(task, project, lang, fakeRes)
    else                          await runWriter(task, project, projectTasks, lang, fakeRes)

    const tList = readJSON(TASKS_FILE, [])
    const idx   = tList.findIndex(t => t.id === taskId)
    if (idx !== -1) {
      tList[idx] = { ...tList[idx], agentType: type, agentOutput: output, agentStatus: 'saved', updatedAt: now() }
      writeJSON(TASKS_FILE, tList)
    }
    console.log(`[agent-bg] ${type} done — "${task.title}"`)
    const typeEmoji = { research: '🔍', write: '✍️', plan: '🗺️' }[type] || '🤖'
    sendTelegram(`🤖 *AI Agent完成*\n\n${typeEmoji} *${task.title}*\n📁 ${project.name}\n\n輸出已就緒，點擊🤖查看並核准。`).catch(() => {})
  } catch (err) {
    console.error('[agent-bg] error:', err.message)
    const tList = readJSON(TASKS_FILE, [])
    const idx   = tList.findIndex(t => t.id === taskId)
    if (idx !== -1) { tList[idx] = { ...tList[idx], agentStatus: 'error', updatedAt: now() }; writeJSON(TASKS_FILE, tList) }
    sendTelegram(`⚠️ *AI Agent錯誤*\n\n*${task?.title || taskId}*\n${err.message}`).catch(() => {})
  }
}

app.put('/api/tasks/:id', (req, res) => {
  const { _lang, ...body } = req.body
  const list = readJSON(TASKS_FILE, [])
  const idx = list.findIndex(t => t.id === req.params.id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  const prev = list[idx]
  list[idx] = { ...prev, ...body, id: req.params.id, updatedAt: now() }

  // Auto-trigger when task first enters in_progress and no agent has run before
  const trigger = body.status === 'in_progress' && prev.status !== 'in_progress' && !prev.agentStatus
  if (trigger) list[idx].agentStatus = 'running'

  writeJSON(TASKS_FILE, list)
  res.json(list[idx])

  if (trigger) {
    runAgentBackground(req.params.id, list[idx].projectId, _lang || 'en').catch(err =>
      console.error('[agent-bg] unhandled:', err.message)
    )
  }
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
// Function so date is fresh on each call (not frozen at startup).
function getPMSystem() {
  return `You are an expert AI project manager with 15 years of experience in software engineering, agile, and product strategy. You help teams plan, execute, and track projects with clarity. Be specific, actionable, and concise. Today's date: ${new Date().toISOString().split('T')[0]}.`
}

// Language directive appended to system prompt so AI responds in the user's selected language.
// For JSON endpoints: values are in the target language; property keys must stay in English.
function getLangDirective(lang) {
  if (lang === 'zh') return ' Respond in Traditional Chinese (繁體中文). For JSON output, keep property names in English but write all string values in Traditional Chinese.'
  if (lang === 'ar') return ' Respond in Arabic (العربية). For JSON output, keep property names in English but write all string values in Arabic.'
  return ''
}

// Generate full project plan as JSON task array
app.post('/api/ai/generate-plan', async (req, res) => {
  const { projectName, description, goal, dueDate, teamSize, lang } = req.body
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

  await streamGenerate(res, getPMSystem() + getLangDirective(lang), prompt, 2000)
})

// Daily standup summary
app.post('/api/ai/standup', async (req, res) => {
  const { project, tasks, lang } = req.body
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

  await streamGenerate(res, getPMSystem() + getLangDirective(lang), prompt, 400)
})

// Risk analysis
app.post('/api/ai/risks', async (req, res) => {
  const { project, tasks, lang } = req.body
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

  await streamGenerate(res, getPMSystem() + getLangDirective(lang), prompt, 700)
})

// Weekly report across all projects
app.post('/api/ai/weekly-report', async (req, res) => {
  const { projects, tasks, lang } = req.body
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

  await streamGenerate(res, getPMSystem() + getLangDirective(lang), prompt, 1200)
})

// Parse meeting notes → extract tasks as JSON
app.post('/api/ai/parse-notes', async (req, res) => {
  const { content, projectName, lang } = req.body

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

  await streamGenerate(res, getPMSystem() + getLangDirective(lang), prompt, 1500)
})

// Translate project fields to target language (non-streaming JSON)
app.post('/api/ai/translate-fields', async (req, res) => {
  const { fields, lang } = req.body
  const langName = lang === 'zh' ? 'Traditional Chinese (繁體中文)' : lang === 'ar' ? 'Arabic (العربية)' : 'English'
  try {
    const text = await multiGenerate([
      { role: 'system', content: 'You are a professional translator. Translate only the values, not the keys. Keep proper nouns and brand names as-is unless they have a standard translation.' },
      { role: 'user', content: `Translate these project fields to ${langName}. Return ONLY a JSON object with the same keys.

${JSON.stringify(fields, null, 2)}

Return only valid JSON, no markdown, no explanation.` },
    ], 400)
    const match = text.match(/\{[\s\S]*\}/)
    res.json(match ? JSON.parse(match[0]) : fields)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Quick task estimation (non-streaming JSON)
app.post('/api/ai/estimate', async (req, res) => {
  const { title, description, projectContext, lang } = req.body
  try {
    const text = await multiGenerate([
      { role: 'system', content: getPMSystem() + getLangDirective(lang) },
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

// Global risk scan across all projects
app.post('/api/ai/global-risks', async (req, res) => {
  const { projects, tasks, lang } = req.body
  const today = new Date().toISOString().split('T')[0]

  const summaries = projects.map(p => {
    const pt = tasks.filter(t => t.projectId === p.id)
    const overdue = pt.filter(t => t.dueDate && t.dueDate < today && t.status !== 'done')
    const blocked = pt.filter(t => t.status === 'blocked')
    const done = pt.filter(t => t.status === 'done').length
    return `**${p.name}** [${p.status}] ${done}/${pt.length} done, due ${p.dueDate || 'N/A'}
Overdue: ${overdue.map(t => t.title).join(', ') || 'None'}
Blocked: ${blocked.map(t => t.title).join(', ') || 'None'}`
  }).join('\n\n')

  const prompt = `Perform a risk scan across all projects.

Today: ${today}

${summaries || 'No projects'}

Provide:
**Overall Health:** Green / Yellow / Red — one sentence
**Critical Issues:** (top 3 risks or blockers across all projects, with project name)
**Per-Project Status:** (one bullet per project with emoji health indicator)
**This Week's Priorities:** (3–5 concrete cross-project actions)`

  await streamGenerate(res, getPMSystem() + getLangDirective(lang), prompt, 800)
})

// ── AI Team Agents ────────────────────────────────────────────────────────────
async function searchWeb(query) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 18000)
  try {
    const url = `https://s.jina.ai/${encodeURIComponent(query)}`
    const r = await undiciFetch(url, {
      headers: { 'Accept': 'text/plain', 'X-No-Cache': 'true' },
      signal: controller.signal,
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const text = await r.text()
    return text.slice(0, 4000)
  } finally {
    clearTimeout(timer)
  }
}

async function classifyTask(title, description) {
  try {
    const result = await multiGenerate([
      { role: 'system', content: 'Classify the task type. Reply with one word only: research, write, or plan.' },
      { role: 'user', content: `Task: "${title}"\n${description ? `Details: ${description}` : ''}\n\nClassify as:\n- research: gather info, market analysis, competitor research, fact-finding\n- write: create documents, reports, emails, proposals, specs, summaries\n- plan: break down work, define subtasks, scheduling, roadmap\n\nOne word only.` },
    ], 10)
    const clean = result?.toLowerCase().trim().replace(/[^a-z]/g, '') || 'write'
    return ['research', 'write', 'plan'].includes(clean) ? clean : 'write'
  } catch { return 'write' }
}

function sseStep(res, text) { res.write(`data: ${JSON.stringify({ type: 'step', text })}\n\n`) }
function sseOut(res, text)  { res.write(`data: ${JSON.stringify({ type: 'output', text })}\n\n`) }

async function streamText(res, text) {
  const CHUNK = 12
  for (let i = 0; i < text.length; i += CHUNK) sseOut(res, text.slice(i, i + CHUNK))
}

async function runResearcher(task, project, lang, res) {
  sseStep(res, '🧠 Planning research strategy...')
  let queries = []
  try {
    const qText = await multiGenerate([
      { role: 'system', content: getPMSystem() },
      { role: 'user', content: `Task: "${task.title}"\nProject: "${project.name}" — ${project.goal || ''}\n\nGenerate 3 targeted search queries. Return ONLY a JSON array: ["q1","q2","q3"]` },
    ], 100)
    const m = qText.match(/\[[\s\S]*?\]/)
    if (m) queries = JSON.parse(m[0])
  } catch {}
  if (!queries.length) queries = [task.title]

  const results = []
  for (const q of queries.slice(0, 3)) {
    sseStep(res, `🔎 Searching: "${q}"`)
    try {
      const content = await searchWeb(q)
      results.push({ query: q, content })
    } catch (e) {
      sseStep(res, `⚠️ Search failed: ${e.message}`)
    }
  }

  sseStep(res, '✍️ Synthesizing findings...')
  const context = results.map(r => `### ${r.query}\n${r.content}`).join('\n\n---\n\n')
  const report = await multiGenerate([
    { role: 'system', content: getPMSystem() + getLangDirective(lang) },
    { role: 'user', content: `Task: "${task.title}"\nProject: "${project.name}" — ${project.goal || ''}\n\n${context ? `Research data:\n${context}\n\n` : ''}Write a comprehensive research report with: key findings, data analysis, recommendations, next steps. Format as markdown with sections.` },
  ], 1500)
  await streamText(res, report)
}

async function runWriter(task, project, projectTasks, lang, res) {
  const contextTasks = projectTasks.filter(t => t.agentOutput && t.id !== task.id)
  if (contextTasks.length) sseStep(res, `📚 Loading context from ${contextTasks.length} task(s)...`)
  sseStep(res, '✍️ Drafting document...')

  const ctx = contextTasks.map(t => `**From "${t.title}" [${t.agentType || 'agent'}]:**\n${t.agentOutput.slice(0, 3000)}`).join('\n\n')
  const draft = await multiGenerate([
    { role: 'system', content: getPMSystem() + getLangDirective(lang) },
    { role: 'user', content: `Task: "${task.title}"\n${task.description ? `Details: ${task.description}\n` : ''}Project: "${project.name}" — ${project.goal || ''}\n\n${ctx ? `Context from other completed tasks:\n${ctx}\n\n` : ''}Write a complete, professional document for this task. Use all available context. Format as clear markdown.` },
  ], 1500)
  await streamText(res, draft)
}

async function runPlanner(task, project, lang, res) {
  sseStep(res, '🗺️ Breaking down into subtasks...')
  const plan = await multiGenerate([
    { role: 'system', content: getPMSystem() + getLangDirective(lang) },
    { role: 'user', content: `Task: "${task.title}"\n${task.description ? `Details: ${task.description}\n` : ''}Project: "${project.name}" — ${project.goal || ''}\n\nCreate an execution plan:\n1. Brief approach (2-3 sentences)\n2. 3-7 subtasks as JSON in a code block:\n\`\`\`json\n[\n  {"title":"...","type":"research|write|action","description":"...","priority":"low|medium|high","estimatedHours":N}\n]\n\`\`\`\n\nFormat as markdown.` },
  ], 1000)
  await streamText(res, plan)
}

app.post('/api/ai/agent-run', async (req, res) => {
  const { taskId, projectId, agentType, lang } = req.body
  const task    = readJSON(TASKS_FILE, []).find(t => t.id === taskId)
  const project = readJSON(PROJECTS_FILE, []).find(p => p.id === projectId)
  if (!task || !project) return res.status(404).json({ error: 'not found' })

  const projectTasks = readJSON(TASKS_FILE, []).filter(t => t.projectId === projectId)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    let type = agentType
    if (!type || type === 'auto') {
      sseStep(res, '🤖 Analyzing task...')
      type = await classifyTask(task.title, task.description)
      sseStep(res, `📋 Agent type: ${type}`)
    }

    if (type === 'research') await runResearcher(task, project, lang, res)
    else if (type === 'plan')  await runPlanner(task, project, lang, res)
    else                       await runWriter(task, project, projectTasks, lang, res)

    // Persist agentType so writer agents can use research output as context
    const tList = readJSON(TASKS_FILE, [])
    const idx = tList.findIndex(t => t.id === taskId)
    if (idx !== -1) { tList[idx].agentType = type; tList[idx].updatedAt = now(); writeJSON(TASKS_FILE, tList) }

    console.log(`[agent] ${type} completed — "${task.title}"`)
  } catch (err) {
    console.error('[agent] error:', err.message)
    sseStep(res, `❌ Error: ${err.message}`)
  }

  res.write('data: [DONE]\n\n')
  res.end()
})

// ── Morning digest ────────────────────────────────────────────────────────────
async function sendTelegram(text) {
  const botToken = process.env.BOT_TOKEN
  const chatId   = process.env.OWNER_TELEGRAM_ID
  if (!botToken || !chatId) return
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    })
  } catch (err) { console.error('[telegram] send error:', err.message) }
}

let _lastDigestAt = null

async function sendMorningDigest() {
  const botToken = process.env.BOT_TOKEN
  const chatId   = process.env.OWNER_TELEGRAM_ID
  if (!botToken || !chatId) { console.warn('[digest] BOT_TOKEN or OWNER_TELEGRAM_ID not set'); return }

  const projects = readJSON(PROJECTS_FILE, []).filter(p => p.status === 'active')
  if (!projects.length) { console.log('[digest] no active projects, skipping'); return }

  const allTasks = readJSON(TASKS_FILE, [])
  const today = new Date().toISOString().split('T')[0]

  const summaries = projects.map(p => {
    const pt = allTasks.filter(t => t.projectId === p.id)
    const ip = pt.filter(t => t.status === 'in_progress').map(t => t.title)
    const bl = pt.filter(t => t.status === 'blocked').map(t => t.title)
    const od = pt.filter(t => t.dueDate && t.dueDate < today && t.status !== 'done').map(t => t.title)
    const td = pt.filter(t => t.status === 'todo').slice(0, 3).map(t => t.title)
    const done = pt.filter(t => t.status === 'done').length
    return `Project: ${p.name} (${done}/${pt.length} done${p.dueDate ? ', due ' + p.dueDate : ''})
In Progress: ${ip.join(', ') || 'none'}
Blocked: ${bl.join(', ') || 'none'}
Overdue: ${od.join(', ') || 'none'}
Next Up: ${td.join(', ') || 'none'}`
  }).join('\n\n')

  const prompt = `Write a tight morning digest for these active projects. One section per project (max 3 bullets each). End with a single "🎯 Today's focus:" line across all projects.

${summaries}

Rules:
- Telegram markdown: *bold* for project names, • for bullets
- Each bullet is one concrete action or key status
- Prefix blocked items with ⚠️, overdue with 🔴
- Under 200 words total`

  let text
  try {
    text = await multiGenerate([
      { role: 'system', content: getPMSystem() },
      { role: 'user', content: prompt },
    ], 500)
  } catch (e) {
    console.warn('[digest] AI failed, using plain summary:', e.message)
  }
  if (!text) {
    text = projects.map(p => {
      const pt = allTasks.filter(t => t.projectId === p.id)
      const done = pt.filter(t => t.status === 'done').length
      const ip = pt.filter(t => t.status === 'in_progress').length
      const bl = pt.filter(t => t.status === 'blocked').length
      return `• *${p.name}*: ${done}/${pt.length} done${ip ? `, ${ip} in progress` : ''}${bl ? `, ⚠️ ${bl} blocked` : ''}`
    }).join('\n')
  }

  const dateStr = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'short' })
  const msg = `📋 *AI PM 早安 — ${dateStr}*\n\n${text}`

  await sendTelegram(msg)
  _lastDigestAt = new Date().toISOString()
  console.log(`[digest] sent — ${projects.length} projects`)
}

function scheduleNextDigest() {
  // Use Intl to correctly determine current Taipei time regardless of system timezone.
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false })
  const parts = Object.fromEntries(f.formatToParts(new Date()).map(p => [p.type, +p.value]))
  const elapsedSec = parts.hour * 3600 + parts.minute * 60 + parts.second
  const untilSec = (9 * 3600 - elapsedSec + 86400) % 86400 || 86400
  const ms = untilSec * 1000
  console.log(`[digest] next run: 09:00 Taipei (in ${Math.floor(ms/3600000)}h ${Math.floor(ms%3600000/60000)}m)`)
  setTimeout(async () => {
    await sendMorningDigest().catch(e => console.error('[digest] error:', e.message))
    scheduleNextDigest()
  }, ms)
}

// Manual trigger for testing — GET /pm/api/ai/digest/now
app.get('/api/ai/digest/now', async (req, res) => {
  res.json({ ok: true, message: 'Digest sending…' })
  await sendMorningDigest().catch(e => console.error('[digest] manual trigger error:', e.message))
})

// ── Provider status check ─────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    providers: PROVIDERS.map(p => ({ name: p.name, configured: !!p.key, model: p.model })),
    dataDir: DATA_DIR,
    projects: readJSON(PROJECTS_FILE, []).length,
    tasks: readJSON(TASKS_FILE, []).length,
    lastDigestAt: _lastDigestAt,
  })
})

// ── Frontend (production) ─────────────────────────────────────────────────────
// Served under /pm so proxy route { prefix: '/pm', target: 3004 } (no strip) works.
// Direct access: http://host:3004/ redirects to /pm
if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(__dirname, '../dist')
  app.get('/', (req, res) => res.redirect('/pm'))
  // No-cache for HTML so browsers always fetch the latest bundle filename.
  // Hashed JS/CSS assets are fine to cache (filenames change on rebuild).
  app.use('/pm', (req, res, next) => {
    if (!req.path || req.path === '/' || req.path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store')
    }
    next()
  })
  app.use('/pm', express.static(distDir))
  app.get('/pm*', (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

const PORT = process.env.PORT || 3004
app.listen(PORT, () => {
  console.log(`[ai-pm] started on port ${PORT}`)
  scheduleNextDigest()
})
