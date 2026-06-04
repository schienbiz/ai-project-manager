// ── SOP (auto-healing built-in) ───────────────────────────────────────────────
// Service crash        → KeepAlive:true in plist restarts automatically
// AI provider timeout  → multiGenerate() races all 3 providers, falls back sequentially
// AI provider 429      → circuit breaker skips that provider for 60s, auto-recovers
// AI provider 413      → tryProvider() auto-truncates user message by 50% and retries once
// All AI providers fail → morning digest sends a plain-text summary instead
// DB error             → logged; routes return 500; KeepAlive restarts on crash
// Silent crash         → unhandledRejection + uncaughtException log to /tmp/ai-project-manager.err
// Agent error          → click ⚠️ badge to retry; calls POST /api/tasks/:id/agent/retry
//
// Manual SOP (when auto-healing isn't enough):
//  Log:       ssh chusMBp "tail -50 /tmp/ai-project-manager.log"
//  Errors:    ssh chusMBp "tail -20 /tmp/ai-project-manager.err"
//  Restart:   ssh chusMBp "launchctl kickstart -k gui/501/com.ai-project-manager.dev"
//  Status:    curl http://localhost:3004/pm/api/status
//  Digest:    curl http://localhost:3004/pm/api/ai/digest/now
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
import pg from 'pg'
import { homedir } from 'os'

dotenv.config()

const { Pool } = pg

// ── Database ──────────────────────────────────────────────────────────────────
// Use CockroachDB CA cert if present (~/.postgresql/root.crt), otherwise fall
// back to Node.js built-in CAs. Needed on macOS Monterey (chusMBp) whose
// CA bundle doesn't include the intermediate used by CockroachDB Serverless.
const _rootCrt = path.join(homedir(), '.postgresql', 'root.crt')
const _sslOpts = fs.existsSync(_rootCrt)
  ? { rejectUnauthorized: true, ca: fs.readFileSync(_rootCrt).toString() }
  : { rejectUnauthorized: true }

// Strip sslmode from URL — pg driver's sslmode param overrides the ssl config
// object, preventing the ca cert from being used on macOS Monterey (chusMBp).
const _dbUrl = new URL(process.env.DATABASE_URL)
_dbUrl.searchParams.delete('sslmode')

const pool = new Pool({
  connectionString: _dbUrl.toString(),
  ssl: _sslOpts,
  max: 5,
  idleTimeoutMillis: 30_000,
})

pool.on('error', (err) => console.error('[db] pool error:', err.message))

const db = { query: (text, params) => pool.query(text, params) }

async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      goal TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      priority TEXT NOT NULL DEFAULT 'medium',
      start_date TEXT,
      due_date TEXT,
      tags JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`)
  await db.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'medium',
      estimated_hours NUMERIC,
      actual_hours NUMERIC,
      due_date TEXT,
      assignee TEXT NOT NULL DEFAULT '',
      tags JSONB NOT NULL DEFAULT '[]',
      sort_order INT NOT NULL DEFAULT 0,
      agent_type TEXT,
      agent_status TEXT,
      agent_output TEXT,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`)
  await db.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      ai_extracted JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL
    )`)
  await db.query(`
    CREATE TABLE IF NOT EXISTS digest_state (
      id INT PRIMARY KEY DEFAULT 1,
      last_digest_at TIMESTAMPTZ
    )`)
  await db.query(`INSERT INTO digest_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`)
  console.log('[db] schema ready')
}

// ── Row mappers (snake_case DB → camelCase API) ───────────────────────────────
function rowToProject(r) {
  return {
    id: r.id, name: r.name, description: r.description, goal: r.goal,
    status: r.status, priority: r.priority,
    startDate: r.start_date, dueDate: r.due_date,
    tags: r.tags,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}
function rowToTask(r) {
  return {
    id: r.id, projectId: r.project_id,
    title: r.title, description: r.description,
    status: r.status, priority: r.priority,
    estimatedHours: r.estimated_hours !== null ? Number(r.estimated_hours) : null,
    actualHours: r.actual_hours !== null ? Number(r.actual_hours) : null,
    dueDate: r.due_date, assignee: r.assignee, tags: r.tags,
    sortOrder: r.sort_order,
    agentType: r.agent_type, agentStatus: r.agent_status, agentOutput: r.agent_output,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}
function rowToNote(r) {
  return {
    id: r.id, projectId: r.project_id,
    content: r.content, aiExtracted: r.ai_extracted,
    createdAt: r.created_at,
  }
}

// macOS system certs fix (same pattern as other chusMBp apps)
let customFetch
try {
  const ca = execSync(
    'security export -t certs -f pemseq -k /System/Library/Keychains/SystemRootCertificates.keychain 2>/dev/null',
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  )
  if (ca.trim()) {
    const agent = new Agent({ connect: { ca, rejectUnauthorized: true } })
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
  {
    name: 'NVIDIA',
    key: process.env.NVIDIA_API_KEY,
    baseURL: 'https://integrate.api.nvidia.com/v1',
    model: 'meta/llama-3.3-70b-instruct',
    timeout: 30_000,
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

const _cooldown = {}
function isCoolingDown(name) {
  return _cooldown[name] && Date.now() < _cooldown[name]
}
function setCooldown(name, ms = 60_000) {
  _cooldown[name] = Date.now() + ms
  const until = new Date(Date.now() + ms).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei' })
  console.log(`[circuit] ${name} rate-limited (429) — cooldown ${ms / 1000}s, resumes ${until} Taipei`)
}

async function tryProvider(p, messages, maxTokens, _isRetry = false) {
  if (!p.key) return null
  if (isCoolingDown(p.name)) {
    console.log(`[circuit] ${p.name} skipped — cooling down`)
    return null
  }
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
    const is429 = err.status === 429 || err.message?.includes('429')
    const is413 = err.status === 413 || err.message?.includes('413') || err.message?.includes('too large')
    if (is429) {
      setCooldown(p.name, 60_000)
    } else if (is413 && !_isRetry) {
      const truncated = messages.map(m =>
        m.role === 'user' ? { ...m, content: m.content.slice(0, Math.floor(m.content.length / 2)) } : m
      )
      console.warn(`[ai] ${p.name} 413 — retrying with truncated context (${truncated.find(m => m.role === 'user')?.content.length} chars)`)
      return tryProvider(p, truncated, maxTokens, true)
    } else {
      console.warn(`[ai] ${p.name} failed: ${err.message?.slice(0, 80)}`)
    }
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

// ── Express setup ─────────────────────────────────────────────────────────────
app.use(cors())
app.use(express.json({ limit: '2mb' }))

// Rewrite /pm/api/* → /api/*
app.use((req, res, next) => {
  if (req.url.startsWith('/pm/api/')) req.url = req.url.slice(3)
  next()
})

const now = () => new Date().toISOString()
const uid = () => randomUUID()

// ── Projects ──────────────────────────────────────────────────────────────────
app.get('/api/projects', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM projects ORDER BY created_at DESC')
    res.json(rows.map(rowToProject))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/projects', async (req, res) => {
  try {
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
    await db.query(
      `INSERT INTO projects (id,name,description,goal,status,priority,start_date,due_date,tags,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [item.id, item.name, item.description, item.goal, item.status, item.priority,
       item.startDate, item.dueDate, JSON.stringify(item.tags), item.createdAt, item.updatedAt]
    )
    res.json(item)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/projects/quick-start', async (req, res) => {
  const title = req.body?.title?.trim()
  const lang  = req.body?.lang
  if (!title) return res.status(400).json({ error: 'title required' })

  try {
    const project = {
      id: uid(), name: title, description: '', goal: '',
      status: 'active', priority: 'medium',
      startDate: null, dueDate: null, tags: [],
      createdAt: now(), updatedAt: now(),
    }
    await db.query(
      `INSERT INTO projects (id,name,description,goal,status,priority,start_date,due_date,tags,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [project.id, project.name, project.description, project.goal, project.status, project.priority,
       project.startDate, project.dueDate, JSON.stringify(project.tags), project.createdAt, project.updatedAt]
    )

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

    const createdTasks = []
    for (let i = 0; i < tasksData.length; i++) {
      const t = tasksData[i]
      const task = {
        id: uid(), projectId: project.id,
        title: t.title || 'Untitled Task', description: t.description || '',
        status: 'todo',
        priority: ['low','medium','high','urgent'].includes(t.priority) ? t.priority : 'medium',
        estimatedHours: typeof t.estimatedHours === 'number' ? t.estimatedHours : null,
        actualHours: null, dueDate: t.dueDate || null,
        assignee: '', tags: [], sortOrder: i,
        createdAt: now(), updatedAt: now(),
      }
      await db.query(
        `INSERT INTO tasks (id,project_id,title,description,status,priority,estimated_hours,actual_hours,due_date,assignee,tags,sort_order,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [task.id, task.projectId, task.title, task.description, task.status, task.priority,
         task.estimatedHours, task.actualHours, task.dueDate, task.assignee,
         JSON.stringify(task.tags), task.sortOrder, task.createdAt, task.updatedAt]
      )
      createdTasks.push(task)
    }

    console.log(`[quick-start] "${title}" → ${createdTasks.length} tasks`)
    res.json({ project, tasks: createdTasks })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/projects/:id', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM projects WHERE id=$1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json(rowToProject(rows[0]))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.put('/api/projects/:id', async (req, res) => {
  try {
    const b = req.body
    const { rows } = await db.query(
      `UPDATE projects SET
         name=$1, description=$2, goal=$3, status=$4, priority=$5,
         start_date=$6, due_date=$7, tags=$8, updated_at=$9
       WHERE id=$10 RETURNING *`,
      [b.name, b.description ?? '', b.goal ?? '', b.status ?? 'active', b.priority ?? 'medium',
       b.startDate ?? null, b.dueDate ?? null,
       JSON.stringify(b.tags ?? []), now(), req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    res.json(rowToProject(rows[0]))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/projects/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM notes WHERE project_id=$1', [req.params.id])
    await db.query('DELETE FROM tasks WHERE project_id=$1', [req.params.id])
    await db.query('DELETE FROM projects WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Tasks ─────────────────────────────────────────────────────────────────────
app.get('/api/tasks', async (req, res) => {
  try {
    const { projectId } = req.query
    const { rows } = projectId
      ? await db.query('SELECT * FROM tasks WHERE project_id=$1 ORDER BY sort_order ASC, created_at ASC', [projectId])
      : await db.query('SELECT * FROM tasks ORDER BY created_at ASC')
    res.json(rows.map(rowToTask))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/tasks', async (req, res) => {
  try {
    const { rows: countRows } = await db.query(
      'SELECT COUNT(*) as cnt FROM tasks WHERE project_id=$1', [req.body.projectId]
    )
    const sortOrder = parseInt(countRows[0].cnt, 10)
    const item = {
      id: uid(), projectId: req.body.projectId,
      title: req.body.title || 'Untitled Task',
      description: req.body.description || '',
      status: req.body.status || 'todo',
      priority: req.body.priority || 'medium',
      estimatedHours: req.body.estimatedHours ?? null,
      actualHours: req.body.actualHours ?? null,
      dueDate: req.body.dueDate || null,
      assignee: req.body.assignee || '',
      tags: req.body.tags || [],
      sortOrder,
      createdAt: now(), updatedAt: now(),
    }
    await db.query(
      `INSERT INTO tasks (id,project_id,title,description,status,priority,estimated_hours,actual_hours,due_date,assignee,tags,sort_order,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [item.id, item.projectId, item.title, item.description, item.status, item.priority,
       item.estimatedHours, item.actualHours, item.dueDate, item.assignee,
       JSON.stringify(item.tags), item.sortOrder, item.createdAt, item.updatedAt]
    )
    res.json(item)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.put('/api/tasks/bulk', async (req, res) => {
  try {
    const updates = req.body
    for (const u of updates) {
      await db.query(
        `UPDATE tasks SET
           title=COALESCE($1,title), description=COALESCE($2,description),
           status=COALESCE($3,status), priority=COALESCE($4,priority),
           estimated_hours=COALESCE($5,estimated_hours), actual_hours=COALESCE($6,actual_hours),
           due_date=COALESCE($7,due_date), assignee=COALESCE($8,assignee),
           sort_order=COALESCE($9,sort_order), agent_type=COALESCE($10,agent_type),
           agent_status=COALESCE($11,agent_status), agent_output=COALESCE($12,agent_output),
           updated_at=$13
         WHERE id=$14`,
        [u.title, u.description, u.status, u.priority,
         u.estimatedHours, u.actualHours, u.dueDate, u.assignee,
         u.sortOrder, u.agentType, u.agentStatus, u.agentOutput,
         now(), u.id]
      )
    }
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

async function runAgentBackground(taskId, projectId, lang) {
  let task, project
  try {
    const { rows: tr } = await db.query('SELECT * FROM tasks WHERE id=$1', [taskId])
    const { rows: pr } = await db.query('SELECT * FROM projects WHERE id=$1', [projectId])
    if (!tr.length || !pr.length) return
    task = rowToTask(tr[0])
    project = rowToProject(pr[0])

    const { rows: projectTaskRows } = await db.query('SELECT * FROM tasks WHERE project_id=$1', [projectId])
    const projectTasks = projectTaskRows.map(rowToTask)
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

    await db.query(
      'UPDATE tasks SET agent_type=$1, agent_output=$2, agent_status=$3, updated_at=$4 WHERE id=$5',
      [type, output, 'saved', now(), taskId]
    )
    console.log(`[agent-bg] ${type} done — "${task.title}"`)
    const typeEmoji = { research: '🔍', write: '✍️', plan: '🗺️' }[type] || '🤖'
    sendTelegram(`🤖 *AI Agent完成*\n\n${typeEmoji} *${task.title}*\n📁 ${project.name}\n\n輸出已就緒，點擊🤖查看並核准。`).catch(() => {})
  } catch (err) {
    console.error('[agent-bg] error:', err.message)
    await db.query('UPDATE tasks SET agent_status=$1, updated_at=$2 WHERE id=$3', ['error', now(), taskId]).catch(() => {})
    sendTelegram(`⚠️ *AI Agent錯誤*\n\n*${task?.title || taskId}*\n${err.message}`).catch(() => {})
  }
}

app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { _lang, ...body } = req.body
    const { rows: prev } = await db.query('SELECT * FROM tasks WHERE id=$1', [req.params.id])
    if (!prev.length) return res.status(404).json({ error: 'Not found' })
    const p = rowToTask(prev[0])

    const trigger = body.status === 'in_progress' && p.status !== 'in_progress' && !p.agentStatus
    const agentStatus = trigger ? 'running' : (body.agentStatus ?? p.agentStatus)

    const { rows } = await db.query(
      `UPDATE tasks SET
         title=COALESCE($1,title), description=COALESCE($2,description),
         status=COALESCE($3,status), priority=COALESCE($4,priority),
         estimated_hours=COALESCE($5,estimated_hours), actual_hours=COALESCE($6,actual_hours),
         due_date=$7, assignee=COALESCE($8,assignee),
         tags=COALESCE($9,tags), sort_order=COALESCE($10,sort_order),
         agent_type=COALESCE($11,agent_type), agent_status=$12,
         agent_output=COALESCE($13,agent_output), updated_at=$14
       WHERE id=$15 RETURNING *`,
      [body.title, body.description, body.status, body.priority,
       body.estimatedHours, body.actualHours,
       body.dueDate !== undefined ? body.dueDate : p.dueDate,
       body.assignee, body.tags ? JSON.stringify(body.tags) : null,
       body.sortOrder, body.agentType, agentStatus,
       body.agentOutput, now(), req.params.id]
    )
    const updated = rowToTask(rows[0])
    res.json(updated)

    if (trigger) {
      runAgentBackground(req.params.id, updated.projectId, _lang || 'en').catch(err =>
        console.error('[agent-bg] unhandled:', err.message)
      )
    }
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/tasks/:id/agent/retry', async (req, res) => {
  try {
    const { rows } = await db.query(
      'UPDATE tasks SET agent_status=$1, updated_at=$2 WHERE id=$3 RETURNING *',
      ['running', now(), req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Not found' })
    const task = rowToTask(rows[0])
    res.json(task)
    runAgentBackground(req.params.id, task.projectId, req.body.lang || 'en').catch(err =>
      console.error('[agent-bg] retry unhandled:', err.message)
    )
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM tasks WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Notes ─────────────────────────────────────────────────────────────────────
app.get('/api/notes', async (req, res) => {
  try {
    const { projectId } = req.query
    const { rows } = projectId
      ? await db.query('SELECT * FROM notes WHERE project_id=$1 ORDER BY created_at DESC', [projectId])
      : await db.query('SELECT * FROM notes ORDER BY created_at DESC')
    res.json(rows.map(rowToNote))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/notes', async (req, res) => {
  try {
    const item = {
      id: uid(), projectId: req.body.projectId,
      content: req.body.content || '',
      aiExtracted: req.body.aiExtracted || [],
      createdAt: now(),
    }
    await db.query(
      'INSERT INTO notes (id,project_id,content,ai_extracted,created_at) VALUES ($1,$2,$3,$4,$5)',
      [item.id, item.projectId, item.content, JSON.stringify(item.aiExtracted), item.createdAt]
    )
    res.json(item)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/notes/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM notes WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── Dashboard stats ───────────────────────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  try {
    const { rows: projects } = await db.query('SELECT * FROM projects ORDER BY created_at DESC')
    const { rows: tasks }    = await db.query('SELECT * FROM tasks')
    const today   = new Date().toISOString().split('T')[0]
    const in7days = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]
    const p = projects.map(rowToProject)
    const t = tasks.map(rowToTask)
    res.json({
      totalProjects:     p.length,
      activeProjects:    p.filter(x => x.status === 'active').length,
      completedProjects: p.filter(x => x.status === 'completed').length,
      totalTasks:        t.length,
      todoTasks:         t.filter(x => x.status === 'todo').length,
      inProgressTasks:   t.filter(x => x.status === 'in_progress').length,
      reviewTasks:       t.filter(x => x.status === 'review').length,
      doneTasks:         t.filter(x => x.status === 'done').length,
      blockedTasks:      t.filter(x => x.status === 'blocked').length,
      overdueTasks:      t.filter(x => x.dueDate && x.dueDate < today && x.status !== 'done').length,
      upcomingProjects:  p.filter(x => x.dueDate && x.dueDate >= today && x.dueDate <= in7days && x.status === 'active')
                          .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      recentProjects: p.slice(0, 5),
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ── AI system prompt ──────────────────────────────────────────────────────────
function getPMSystem() {
  return `You are an expert AI project manager with 15 years of experience in software engineering, agile, and product strategy. You help teams plan, execute, and track projects with clarity. Be specific, actionable, and concise. Today's date: ${new Date().toISOString().split('T')[0]}.`
}

function getLangDirective(lang) {
  if (lang === 'zh') return ' Respond in Traditional Chinese (繁體中文). For JSON output, keep property names in English but write all string values in Traditional Chinese.'
  if (lang === 'ar') return ' Respond in Arabic (العربية). For JSON output, keep property names in English but write all string values in Arabic.'
  return ''
}

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

app.post('/api/ai/standup', async (req, res) => {
  const { project, lang } = req.body
  const tasks = req.body.tasks || []
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

app.post('/api/ai/risks', async (req, res) => {
  const { project, lang } = req.body
  const tasks = req.body.tasks || []
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

app.post('/api/ai/weekly-report', async (req, res) => {
  const { projects, tasks, lang } = req.body
  const today = new Date().toISOString().split('T')[0]

  const summaries = projects.map(p => {
    const pt    = tasks.filter(t => t.projectId === p.id)
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

app.post('/api/ai/translate-fields', async (req, res) => {
  const { fields, lang } = req.body
  const langName = lang === 'zh' ? 'Traditional Chinese (繁體中文)' : lang === 'ar' ? 'Arabic (العربية)' : 'English'
  try {
    const text = await multiGenerate([
      { role: 'system', content: 'You are a professional translator. Translate only the values, not the keys. Keep proper nouns and brand names as-is unless they have a standard translation.' },
      { role: 'user', content: `Translate these project fields to ${langName}. Return ONLY a JSON object with the same keys.\n\n${JSON.stringify(fields, null, 2)}\n\nReturn only valid JSON, no markdown, no explanation.` },
    ], 400)
    const match = text.match(/\{[\s\S]*\}/)
    res.json(match ? JSON.parse(match[0]) : fields)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/ai/estimate', async (req, res) => {
  const { title, description, projectContext, lang } = req.body
  try {
    const text = await multiGenerate([
      { role: 'system', content: getPMSystem() + getLangDirective(lang) },
      { role: 'user', content: `Estimate the effort for this task. Return ONLY a JSON object:\n{\n  "hours": number,\n  "confidence": "low" | "medium" | "high",\n  "rationale": "one sentence",\n  "subtasks": ["step 1", "step 2", ...]\n}\n\nTask: ${title}\nDetails: ${description || 'None'}\nProject context: ${projectContext || 'Software project'}\n\nReturn only JSON.` },
    ], 300)
    const match = text.match(/\{[\s\S]*\}/)
    res.json(match ? JSON.parse(match[0]) : { hours: null, confidence: 'low', rationale: text, subtasks: [] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/ai/global-risks', async (req, res) => {
  const { projects, tasks, lang } = req.body
  const today = new Date().toISOString().split('T')[0]

  const summaries = projects.map(p => {
    const pt = tasks.filter(t => t.projectId === p.id)
    const overdue = pt.filter(t => t.dueDate && t.dueDate < today && t.status !== 'done')
    const blocked = pt.filter(t => t.status === 'blocked')
    const done = pt.filter(t => t.status === 'done').length
    return `**${p.name}** [${p.status}] ${done}/${pt.length} done, due ${p.dueDate || 'N/A'}\nOverdue: ${overdue.map(t => t.title).join(', ') || 'None'}\nBlocked: ${blocked.map(t => t.title).join(', ') || 'None'}`
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
  const { rows: tr } = await db.query('SELECT * FROM tasks WHERE id=$1', [taskId])
  const { rows: pr } = await db.query('SELECT * FROM projects WHERE id=$1', [projectId])
  if (!tr.length || !pr.length) return res.status(404).json({ error: 'not found' })
  const task = rowToTask(tr[0])
  const project = rowToProject(pr[0])
  const { rows: allTaskRows } = await db.query('SELECT * FROM tasks WHERE project_id=$1', [projectId])
  const projectTasks = allTaskRows.map(rowToTask)

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

    await db.query('UPDATE tasks SET agent_type=$1, updated_at=$2 WHERE id=$3', [type, now(), taskId])
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
  const _fetch = customFetch ?? fetch
  try {
    await _fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    })
  } catch (err) { console.error('[telegram] send error:', err.message) }
}

let _lastDigestAt = null

function digestSentToday() {
  if (!_lastDigestAt) return false
  const taipeiDay = (d) => new Date(d).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' })
  return taipeiDay(_lastDigestAt) === taipeiDay(new Date())
}

async function sendMorningDigest() {
  const botToken = process.env.BOT_TOKEN
  const chatId   = process.env.OWNER_TELEGRAM_ID
  if (!botToken || !chatId) { console.warn('[digest] BOT_TOKEN or OWNER_TELEGRAM_ID not set'); return }

  const { rows: projectRows } = await db.query(`SELECT * FROM projects WHERE status='active'`)
  const projects = projectRows.map(rowToProject)
  if (!projects.length) { console.log('[digest] no active projects, skipping'); return }

  const { rows: taskRows } = await db.query('SELECT * FROM tasks')
  const allTasks = taskRows.map(rowToTask)
  const today = new Date().toISOString().split('T')[0]

  const summaries = projects.map(p => {
    const pt = allTasks.filter(t => t.projectId === p.id)
    const ip = pt.filter(t => t.status === 'in_progress').map(t => t.title)
    const bl = pt.filter(t => t.status === 'blocked').map(t => t.title)
    const od = pt.filter(t => t.dueDate && t.dueDate < today && t.status !== 'done').map(t => t.title)
    const td = pt.filter(t => t.status === 'todo').slice(0, 3).map(t => t.title)
    const done = pt.filter(t => t.status === 'done').length
    return `Project: ${p.name} (${done}/${pt.length} done${p.dueDate ? ', due ' + p.dueDate : ''})\nIn Progress: ${ip.join(', ') || 'none'}\nBlocked: ${bl.join(', ') || 'none'}\nOverdue: ${od.join(', ') || 'none'}\nNext Up: ${td.join(', ') || 'none'}`
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
  await db.query('UPDATE digest_state SET last_digest_at=$1 WHERE id=1', [_lastDigestAt])
  console.log(`[digest] sent — ${projects.length} projects`)
}

function scheduleNextDigest() {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false })
  const parts = Object.fromEntries(f.formatToParts(new Date()).map(p => [p.type, +p.value]))
  const elapsedSec = parts.hour * 3600 + parts.minute * 60 + parts.second
  const untilSec = (9 * 3600 - elapsedSec + 86400) % 86400 || 86400
  const ms = untilSec * 1000
  console.log(`[digest] next run: 09:00 Taipei (in ${Math.floor(ms/3600000)}h ${Math.floor(ms%3600000/60000)}m)`)
  setTimeout(async () => {
    if (digestSentToday()) {
      console.log('[digest] already sent today — skipping duplicate')
    } else {
      await sendMorningDigest().catch(e => console.error('[digest] error:', e.message))
    }
    scheduleNextDigest()
  }, ms)
}

app.get('/api/ai/digest/now', async (req, res) => {
  res.json({ ok: true, message: 'Digest sending…' })
  await sendMorningDigest().catch(e => console.error('[digest] manual trigger error:', e.message))
})

// ── Provider status ───────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  const ts = Date.now()
  let projectCount = 0, taskCount = 0
  try {
    const { rows: pc } = await db.query('SELECT COUNT(*) as cnt FROM projects')
    const { rows: tc } = await db.query('SELECT COUNT(*) as cnt FROM tasks')
    projectCount = parseInt(pc[0].cnt, 10)
    taskCount    = parseInt(tc[0].cnt, 10)
  } catch {}
  res.json({
    providers: PROVIDERS.map(p => {
      const coolUntil = _cooldown[p.name]
      const coolingDown = !!(coolUntil && ts < coolUntil)
      return { name: p.name, configured: !!p.key, model: p.model, coolingDown, cooldownUntil: coolingDown ? new Date(coolUntil).toISOString() : null }
    }),
    storage: 'cockroachdb',
    projects: projectCount,
    tasks: taskCount,
    lastDigestAt: _lastDigestAt,
  })
})

// ── Admin ─────────────────────────────────────────────────────────────────────
const ADMIN_SERVICES = [
  { name: 'Relationship OS',  label: 'com.relationship-os.dev',    port: 3000, path: '/health' },
  { name: 'Marketing Asst',   label: 'com.marketing-assistant.dev', port: 3001, path: '/' },
  { name: 'Proxy',            label: 'com.proxy.marketing',         port: 3002, path: '/' },
  { name: 'AI Learning Tool', label: 'com.ai-learning-tool.dev',    port: 3003, path: '/health' },
  { name: 'AI PM',            label: 'com.ai-project-manager.dev',  port: 3004, path: '/pm/api/status' },
]

const ALLOWED_LABELS = new Set(ADMIN_SERVICES.map(s => s.label))

app.get('/api/admin/status', async (req, res) => {
  const checks = ADMIN_SERVICES.map(async (svc) => {
    const t0 = Date.now()
    try {
      const r = await Promise.race([
        fetch(`http://localhost:${svc.port}${svc.path}`),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
      ])
      return { ...svc, status: r.status, latency: Date.now() - t0, healthy: r.status < 400 }
    } catch {
      return { ...svc, status: 0, latency: Date.now() - t0, healthy: false }
    }
  })

  const services = await Promise.all(checks)

  let watchdogLine = 'no log'
  try { watchdogLine = fs.readFileSync('/tmp/watchdog.log', 'utf-8').trim().split('\n').pop() } catch {}

  const ts = Date.now()
  res.json({
    services,
    providers: PROVIDERS.map(p => {
      const coolUntil = _cooldown[p.name]
      const coolingDown = !!(coolUntil && ts < coolUntil)
      return { name: p.name, model: p.model, coolingDown, cooldownUntil: coolingDown ? new Date(coolUntil).toISOString() : null }
    }),
    watchdog: { lastLine: watchdogLine },
    syncthing: { healthy: null },
    digest: { lastDigestAt: _lastDigestAt },
    storage: 'cockroachdb',
    checkedAt: new Date().toISOString(),
  })
})

app.post('/api/admin/restart', (req, res) => {
  const { label } = req.body
  if (!label || !ALLOWED_LABELS.has(label)) return res.status(400).json({ error: 'Invalid label' })
  try {
    execSync(`launchctl kickstart -k gui/501/${label}`, { timeout: 5000 })
    console.log(`[admin] restarted ${label}`)
    res.json({ ok: true, label })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/admin/ssh-diag', (req, res) => {
  let sshdUp = false
  try { execSync('nc -z -w 2 localhost 22', { timeout: 3000 }); sshdUp = true } catch {}
  let borelog = '', boreout = ''
  try { borelog = fs.readFileSync('/tmp/bore-ssh.log', 'utf-8').trim().split('\n').slice(-15).join('\n') } catch {}
  try { boreout = fs.readFileSync('/tmp/bore-ssh-output.log', 'utf-8').trim().slice(-500) } catch {}
  const portMatch = boreout.match(/bore\.pub:(\d+)/)
  res.json({ sshdUp, borePort: portMatch ? portMatch[1] : null, borelog, boreout })
})

// ── Frontend ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const distDir = path.join(__dirname, '../dist')
  app.get('/', (req, res) => res.redirect('/pm'))
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

app.get('/health', (req, res) => res.json({ ok: true, service: 'ai-project-manager' }))

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3004

async function start() {
  await initDb()

  // Restore digest state from DB
  try {
    const { rows } = await db.query('SELECT last_digest_at FROM digest_state WHERE id=1')
    if (rows[0]?.last_digest_at) {
      _lastDigestAt = new Date(rows[0].last_digest_at).toISOString()
      console.log(`[digest] restored lastDigestAt: ${_lastDigestAt}`)
    }
  } catch (err) {
    console.warn('[digest] could not restore state:', err.message)
  }

  app.listen(PORT, () => {
    console.log(`[ai-pm] started on port ${PORT}`)
    scheduleNextDigest()
  })
}

// Retry startup up to 5 times with exponential backoff — CockroachDB Serverless
// sometimes returns ETIMEDOUT on the first connection after a pause.
;(async () => {
  let delay = 5000
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await start()
      return
    } catch (err) {
      console.error(`[ai-pm] startup failed (attempt ${attempt}/5): ${err.message ?? err}`)
      if (attempt === 5) { process.exit(1) }
      await new Promise(r => setTimeout(r, delay))
      delay = Math.min(delay * 2, 30_000)
    }
  }
})()
