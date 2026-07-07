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
import { fetch as undiciFetch } from 'undici'
import express from 'express'
import OpenAI from 'openai'
import nodemailer from 'nodemailer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import cors from 'cors'
import dotenv from 'dotenv'
import pg from 'pg'
import { homedir } from 'os'

dotenv.config()

const { Pool } = pg

// ── Database ──────────────────────────────────────────────────────────────────
// chusMBp macOS: ~/.postgresql/root.crt = Supabase Root 2021 CA → verify-full
// Render Docker / other Linux: no root.crt → rejectUnauthorized:false
// (Supabase uses self-signed CA not in Node.js built-in bundle; still encrypted)
const _rootCrt = path.join(homedir(), '.postgresql', 'root.crt')
const _sslOpts = fs.existsSync(_rootCrt)
  ? { rejectUnauthorized: true, ca: fs.readFileSync(_rootCrt).toString() }
  : { rejectUnauthorized: false }

// Strip sslmode from URL — pg driver's sslmode param overrides the ssl config
// object, preventing the ca cert from being used on macOS Monterey (chusMBp).
const _dbUrl = new URL(process.env.DATABASE_URL)
_dbUrl.searchParams.delete('sslmode')

const pool = new Pool({
  connectionString: _dbUrl.toString(),
  ssl: _sslOpts,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,  // CockroachDB Serverless cold-start: fail fast so retry kicks in sooner
})

pool.on('error', (err) => console.error('[db] pool error:', err.message))

const db = { query: (text, params) => pool.query(text, params) }

// Storage label derived from the REAL DATABASE_URL host — never hardcode it. A stale hardcoded
// 'cockroachdb' (from the pre-2026-06-28 CRDB era) survived the Supabase migration and triggered a
// false "CRDB RU limit" investigation on 2026-07-01. Single source of truth = the connection host.
const STORAGE_KIND = /supabase/i.test(_dbUrl.host) ? 'supabase'
  : /cockroachlabs|crdb|cockroach/i.test(_dbUrl.host) ? 'cockroachdb'
  : /neon/i.test(_dbUrl.host) ? 'neon' : 'postgres'

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
  await db.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_guide TEXT NOT NULL DEFAULT ''`)
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
    userGuide: r.user_guide ?? '',
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

// NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem is set in plist — Node.js global fetch
// already trusts all standard CAs. customFetch/undici Agent is no longer needed.
const customFetch = undefined

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
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
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
    key: process.env.GROQ_QWEN_API_KEY || process.env.GROQ_API_KEY,  // separate key avoids shared rate limit with Groq Llama
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
  ...(process.env.MISTRAL_API_KEY ? [{
    name: 'Mistral',
    key: process.env.MISTRAL_API_KEY,
    baseURL: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    timeout: 15_000,
    fetch: customFetch,
  }] : []),
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

const PROVIDER_STATS_PATH = path.join(__dirname, '../data/provider-stats.json')
function _loadProviderStats() {
  try { return JSON.parse(fs.readFileSync(PROVIDER_STATS_PATH, 'utf-8')) } catch { return {} }
}
const _providerStats = _loadProviderStats()

let _statsFlushTimer = null
function flushProviderStats() {
  if (_statsFlushTimer) return
  _statsFlushTimer = setTimeout(() => {
    _statsFlushTimer = null
    try {
      fs.mkdirSync(path.dirname(PROVIDER_STATS_PATH), { recursive: true })
      fs.writeFileSync(PROVIDER_STATS_PATH, JSON.stringify(_providerStats))
    } catch {}
  }, 2000)
}

function providerStat(name) {
  if (!_providerStats[name]) _providerStats[name] = { ok: 0, err: 0, lastUsed: null }
  return _providerStats[name]
}

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
        const s = providerStat(p.name); s.ok++; s.lastUsed = new Date().toISOString(); flushProviderStats()
        const raw = res.choices[0]?.message?.content?.trim() || null
        return raw?.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || null
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
    providerStat(p.name).err++; flushProviderStats()
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

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 10_000)
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
  } finally {
    clearInterval(keepAlive)
  }
  res.end()
}

// ── Express setup ─────────────────────────────────────────────────────────────
app.use(cors())
app.use(express.json({ limit: '2mb' }))

// ── Admin auth ────────────────────────────────────────────────────────────────
const _adminToken = process.env.ADMIN_TOKEN
function requireAdmin(req, res, next) {
  if (!_adminToken) return next()
  if (req.headers['x-admin-token'] === _adminToken) return next()
  res.status(401).json({ error: 'Unauthorized' })
}

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
      userGuide: req.body.userGuide || '',
      status:   VALID_PROJECT_STATUS.has(req.body.status)     ? req.body.status   : 'active',
      priority: VALID_PROJECT_PRIORITY.has(req.body.priority) ? req.body.priority : 'medium',
      startDate: req.body.startDate || null,
      dueDate: req.body.dueDate || null,
      tags: req.body.tags || [],
      createdAt: now(),
      updatedAt: now(),
    }
    await db.query(
      `INSERT INTO projects (id,name,description,goal,user_guide,status,priority,start_date,due_date,tags,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [item.id, item.name, item.description, item.goal, item.userGuide, item.status, item.priority,
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
         name=$1, description=$2, goal=$3, user_guide=$4, status=$5, priority=$6,
         start_date=$7, due_date=$8, tags=$9, updated_at=$10
       WHERE id=$11 RETURNING *`,
      [b.name, b.description ?? '', b.goal ?? '', b.userGuide ?? '', b.status ?? 'active', b.priority ?? 'medium',
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
app.get('/api/tasks/running', async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT * FROM tasks WHERE agent_status='running' ORDER BY updated_at ASC"
    )
    res.json(rows.map(rowToTask))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/tasks', async (req, res) => {
  try {
    const { projectId } = req.query
    const { rows } = projectId
      ? await db.query('SELECT * FROM tasks WHERE project_id=$1 ORDER BY sort_order ASC, created_at ASC', [projectId])
      : await db.query('SELECT * FROM tasks ORDER BY created_at ASC')
    res.json(rows.map(rowToTask))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

const VALID_TASK_STATUS   = new Set(['todo', 'in_progress', 'done', 'cancelled'])
const VALID_TASK_PRIORITY = new Set(['low', 'medium', 'high', 'urgent'])
const VALID_PROJECT_STATUS   = new Set(['active', 'paused', 'completed', 'archived'])
const VALID_PROJECT_PRIORITY = new Set(['low', 'medium', 'high', 'urgent'])

app.post('/api/tasks', async (req, res) => {
  try {
    if (!req.body.projectId) return res.status(400).json({ error: 'projectId required' })
    const { rows: countRows } = await db.query(
      'SELECT COUNT(*) as cnt FROM tasks WHERE project_id=$1', [req.body.projectId]
    )
    const sortOrder = parseInt(countRows[0].cnt, 10)
    const rawStatus   = req.body.status   || 'todo'
    const rawPriority = req.body.priority || 'medium'
    const item = {
      id: uid(), projectId: req.body.projectId,
      title: req.body.title || 'Untitled Task',
      description: req.body.description || '',
      status:   VALID_TASK_STATUS.has(rawStatus)   ? rawStatus   : 'todo',
      priority: VALID_TASK_PRIORITY.has(rawPriority) ? rawPriority : 'medium',
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
    console.error('[agent-bg] error:', err)
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
        console.error('[agent-bg] unhandled:', err)
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
      console.error('[agent-bg] retry unhandled:', err)
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
    console.error('[agent] error:', err)
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
  } catch (err) { console.error('[telegram] send error:', err) }
}

let _lastDigestAt = null

function digestSentToday() {
  if (!_lastDigestAt) return false
  const taipeiDay = (d) => new Date(d).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' })
  return taipeiDay(_lastDigestAt) === taipeiDay(new Date())
}

async function sendMorningDigest(force = false) {
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

  const expiringKeys = loadVault().filter(e => e.expiry && daysUntil(e.expiry) <= 7)
  const keyWarning = expiringKeys.length
    ? '\n\n⚠️ *API Keys 即將到期:*\n' + expiringKeys.map(e => `• *${e.name}* — ${daysUntil(e.expiry) < 0 ? '已過期' : `${daysUntil(e.expiry)}天後到期`}`).join('\n')
    : ''

  const msg = `📋 *AI PM 早安 — ${dateStr}*\n\n${text}${keyWarning}`

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
      await sendMorningDigest().catch(e => console.error('[digest] error:', e))
    }
    scheduleNextDigest()
  }, ms)
}

app.get('/api/ai/digest/now', async (req, res) => {
  res.json({ ok: true, message: 'Digest sending…' })
  await sendMorningDigest().catch(e => console.error('[digest] manual trigger error:', e.message))
})

app.post('/api/admin/digest/send-now', requireAdmin, async (req, res) => {
  res.json({ ok: true, message: 'Digest sending…' })
  await sendMorningDigest(true).catch(e => console.error('[digest] send-now error:', e.message))
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
    storage: STORAGE_KIND,
    projects: projectCount,
    tasks: taskCount,
    lastDigestAt: _lastDigestAt,
  })
})

// ── Admin ─────────────────────────────────────────────────────────────────────
const ADMIN_SERVICES = [
  { name: 'Relationship OS',  label: 'com.relationship-os.dev',    port: 3000, path: '/health' },
  { name: 'Proxy',            label: 'com.proxy.marketing',         port: 3002, path: '/' },
  { name: 'AI Learning Tool', label: 'com.ai-learning-tool.dev',    port: 3003, path: '/health' },
  { name: 'AI PM',            label: 'com.ai-project-manager.dev',  port: 3004, path: '/pm/api/status' },
  { name: 'Voice Trainer',    label: 'com.voice-trainer',           port: 3005, path: '/health' },
]

const ALLOWED_LABELS = new Set(ADMIN_SERVICES.map(s => s.label))

// ── ATung Mac services (polled via Tailscale) ─────────────────────────────────
const ATUNG_SERVICES = [
  { name: 'Warehouse Scanner', label: 'warehouse-scanner', host: 'atungs-mp25', port: 3008, path: '/health' },
]

// ── Render services (external) ────────────────────────────────────────────────
// workspace = Render free-tier account pool. The real ceiling is 750h/month PER
// WORKSPACE (shared by all awake free services in that account), not per service.
// See hosting-decision-master-2026-06-17.md §3.
const RENDER_SERVICES = [
  { name: '2560戰法 (Worker)',     host: 'two560-app.atungc2020.workers.dev',    path: '/__up',   workspace: 'atungc2020', cf: true },  // CF Worker edge-only 健康檢查(不喚醒後端 two560-app-2)；後端停權狀態由 atungc2020 Render API key 覆蓋。2026-06-19 從 schienbiz two560-app.onrender.com 遷移(舊的已停權，且 HTTP poll 它=keepalive)
  { name: 'Travel Advisor',       host: 'travel-advisor-wwrz.onrender.com',     path: '/',       workspace: 'schienbiz'   },
  { name: 'Intelligence Journal', host: 'intelligence-journal.onrender.com',    path: '/',       workspace: 'schienbiz'   },
  { name: 'Private Network',      host: 'private-network-jahr.onrender.com',    path: '/',       workspace: 'pvnetwork2026' },  // 2026-07-02 遷 atungc2020→pvnetwork2026 隔離 WS 池；舊 private-network-49yk 已 suspend 待刪
  { name: 'Leave Bot',            host: 'leave-bot-oh83.onrender.com',          path: '/',       workspace: 'schienbiz'   },  // verified via Render API 2026-06-19 (was mis-tagged smritichain)
  { name: 'Voice Trainer',        host: 'voice-trainer.onrender.com',           path: '/health', workspace: 'smritichain' },
  { name: 'Self-Journal',         host: 'self-journal.onrender.com',            path: '/health', workspace: 'atungc2020'  },
  { name: 'Warehouse Scanner',    host: 'warehouse-scanner-nchl.onrender.com',  path: '/health', workspace: 'atungc2020'  },
]

// ── Render workspace usage budget (750h/month shared pool, per workspace) ───────
const RENDER_WORKSPACE_CAP_H_DEFAULT = 750            // free-tier hours per workspace per month
const RENDER_USAGE_THRESHOLDS_DEFAULT = [0.70, 0.85, 0.95]   // alert on crossing each (once/month)
const RENDER_USAGE_PATH = path.join(__dirname, '../data/render-usage.json')
const RENDER_USAGE_CONFIG_PATH = path.join(__dirname, '../data/render-usage-config.json')

// Tunable from the admin UI; persisted separately so resetting usage never wipes config.
function normalizeUsageConfig(c) {
  const cap = Number(c?.capHours)
  const capHours = Number.isFinite(cap) && cap > 0 ? cap : RENDER_WORKSPACE_CAP_H_DEFAULT
  let th = Array.isArray(c?.thresholds) ? c.thresholds.map(Number).filter(n => Number.isFinite(n) && n > 0 && n <= 1) : []
  th = [...new Set(th)].sort((a, b) => a - b).slice(0, 5)
  if (!th.length) th = [...RENDER_USAGE_THRESHOLDS_DEFAULT]
  return { capHours, thresholds: th }
}
let _renderUsageConfig = (() => {
  try { return normalizeUsageConfig(JSON.parse(fs.readFileSync(RENDER_USAGE_CONFIG_PATH, 'utf-8'))) } catch {}
  return { capHours: RENDER_WORKSPACE_CAP_H_DEFAULT, thresholds: [...RENDER_USAGE_THRESHOLDS_DEFAULT] }
})()
function saveRenderUsageConfig() {
  try {
    fs.mkdirSync(path.dirname(RENDER_USAGE_CONFIG_PATH), { recursive: true })
    fs.writeFileSync(RENDER_USAGE_CONFIG_PATH, JSON.stringify(_renderUsageConfig))
  } catch (e) { console.error('[render-usage] config save error:', e.message) }
}
// Public shape for API/UI: thresholds as integer percentages.
function usageConfigPublic() {
  return { capHours: _renderUsageConfig.capHours, thresholdsPct: _renderUsageConfig.thresholds.map(t => Math.round(t * 100)) }
}

// Taipei-local YYYY-MM, so the month rolls over on the 1st alongside Render billing.
function taipeiMonth(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit',
  }).formatToParts(d).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}`
}

// { month, awakeSeconds: { [svcName]: n }, alerted: { [workspace]: [pct,…] } }
let _renderUsage = (() => {
  try {
    const u = JSON.parse(fs.readFileSync(RENDER_USAGE_PATH, 'utf-8'))
    if (u && u.month === taipeiMonth()) return u
  } catch {}
  return { month: taipeiMonth(), awakeSeconds: {}, alerted: {} }
})()
let _lastUsageTickAt = null

function saveRenderUsage() {
  try {
    fs.mkdirSync(path.dirname(RENDER_USAGE_PATH), { recursive: true })
    fs.writeFileSync(RENDER_USAGE_PATH, JSON.stringify(_renderUsage))
  } catch (e) { console.error('[render-usage] save error:', e.message) }
}

// Severity by how many configured thresholds the usage fraction has crossed.
function usageLevel(pctFraction) {
  const crossed = _renderUsageConfig.thresholds.filter(t => pctFraction >= t).length
  return ['green', 'yellow', 'orange', 'red'][Math.min(crossed, 3)]
}

// Build per-workspace usage summary from the accumulator (for API + alerts).
function renderUsageSummary() {
  const cap = _renderUsageConfig.capHours
  const ws = {}
  // Prefer the authoritative Render API fleet — covers ALL services incl. those absent from the
  // health-probe list (e.g. line-expense-bot, which ran 24/7 and blew smritichain's pool while
  // the probe-based gauge counted it as 0). Fall back to the probe list before the first API poll.
  const fleet = _renderApiState.services.length
    ? _renderApiState.services.map(s => ({ name: s.name, workspace: s.workspace }))
    : RENDER_SERVICES
  for (const svc of fleet) {
    const w = svc.workspace
    if (!ws[w]) ws[w] = { name: w, capHours: cap, services: [], totalHours: 0 }
    const hours = (_renderUsage.awakeSeconds[svc.name] || 0) / 3600
    ws[w].services.push({ name: svc.name, hours: Math.round(hours * 10) / 10 })
    ws[w].totalHours += hours
  }
  return Object.values(ws).map(w => {
    const pct = w.totalHours / w.capHours
    return {
      ...w,
      totalHours: Math.round(w.totalHours * 10) / 10,
      pct: Math.round(pct * 1000) / 10,                       // 0–100(+), 1 decimal
      level: usageLevel(pct),
    }
  })
}

// Accumulate observed awake-time (healthy poll = service is awake this interval) and
// fire Telegram alerts when a workspace crosses a usage threshold.
// ⚠️ Now that health polls only run while the admin dashboard is open (not on a 24/7 timer),
// this is a LOWER BOUND on real awake-hours, not an authoritative figure — traffic/cron that
// wakes a service while nobody is watching the dashboard goes uncounted. Treat the usage gauge
// as indicative only; authoritative pool usage requires the Render API (RENDER_API_KEY).
function tickRenderUsage(results) {
  const now = Date.now()
  // roll over at Taipei month boundary
  const month = taipeiMonth()
  if (_renderUsage.month !== month) {
    _renderUsage = { month, awakeSeconds: {}, alerted: {} }
    _lastUsageTickAt = null
    console.log(`[render-usage] new month ${month} — counters reset`)
  }
  // Awake-hours are now accumulated authoritatively from the Render metrics API (cpu-datapoint
  // density) in tickRenderUsageFromMetrics() — 24/7, zero keepalive, whole fleet. The old
  // dashboard-probe accumulation here was a severe undercount (probes only run while the admin UI
  // is open) and ignored services not in the probe list, so smritichain hit 106% (line-expense-bot
  // 730h) with zero alert. This path is kept only for month-rollover + threshold responsiveness.
  void now; void results
  checkUsageThresholds()
  saveRenderUsage()
}

// Fire Telegram alerts when a workspace crosses a configured threshold.
// dedup: once per threshold per workspace per month. Idempotent — safe to call on
// config changes (no time accumulation here) so a newly-lowered threshold alerts at once.
function checkUsageThresholds() {
  for (const w of renderUsageSummary()) {
    const fired = _renderUsage.alerted[w.name] || []
    for (const th of _renderUsageConfig.thresholds) {
      if (w.totalHours / w.capHours >= th && !fired.includes(th)) {
        fired.push(th)
        sendTelegram(`⚠️ *Render 用量警告*\n\nWorkspace *${w.name}* 本月已用 *${w.totalHours}h / ${w.capHours}h* (${w.pct}%)\n跨過 ${Math.round(th * 100)}% 門檻。\n用光 → 該帳號所有 free service 一起停到下月 1 號。\n👉 讓可睡的服務真正睡、或分散到其他帳號池。`).catch(() => {})
        console.warn(`[render-usage] ${w.name} crossed ${Math.round(th * 100)}% (${w.totalHours}h/${w.capHours}h)`)
      }
    }
    _renderUsage.alerted[w.name] = fired
  }
}

// Authoritative awake-hours accumulator. Uses the Render metrics API `cpu` series — datapoints
// exist ONLY while an instance is running, so their count × 60s = real awake-time. Runs on the
// safe 24/7 refreshRenderState() timer (hits api.render.com, never the service = zero keepalive),
// covers the whole fleet, and drives the existing 70/85/95% pool-usage Telegram alert with real
// numbers. Best-effort per service; small metric-lag undercount is acceptable for a threshold gauge.
let _lastMetricsUsageAt = null
async function tickRenderUsageFromMetrics(fleet, idKey) {
  const now = Date.now()
  const month = taipeiMonth()
  if (_renderUsage.month !== month) {
    _renderUsage = { month, awakeSeconds: {}, alerted: {} }
    _lastMetricsUsageAt = null
    console.log(`[render-usage] new month ${month} — counters reset`)
  }
  const since = _lastMetricsUsageAt || (now - 5 * 60_000)      // first run: look back one interval
  const startISO = new Date(since - 60_000).toISOString()      // 60s buffer for metric ingest lag
  const endISO = new Date(now).toISOString()
  await Promise.all(fleet.filter(r => r.id && r.suspended !== 'suspended').map(async (rec) => {
    const key = idKey[rec.id]
    if (!key) return
    try {
      const r = await Promise.race([
        fetch(`https://api.render.com/v1/metrics/cpu?resource=${rec.id}&startTime=${encodeURIComponent(startISO)}&endTime=${encodeURIComponent(endISO)}`,
          { headers: { Authorization: `Bearer ${key}` } }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ])
      if (!r.ok) return
      const series = await r.json()
      const fresh = new Set()
      for (const s of (Array.isArray(series) ? series : [])) {
        for (const v of (s.values || [])) {
          if (new Date(v.timestamp).getTime() > since) fresh.add(v.timestamp)   // only new points → no double-count
        }
      }
      if (fresh.size) _renderUsage.awakeSeconds[rec.name] = (_renderUsage.awakeSeconds[rec.name] || 0) + fresh.size * 60
    } catch { /* per-service best-effort */ }
  }))
  _lastMetricsUsageAt = now
  checkUsageThresholds()
  saveRenderUsage()
}

// In-memory cache — admin status returns this instantly instead of blocking on HTTP polls
let _renderCache = { services: [], checkedAt: null }
// State map for alert deduplication (only alert on healthy→unhealthy transitions)
const _renderHealthState = {}

async function refreshRenderCache() {
  const results = await Promise.all(RENDER_SERVICES.map(async (svc) => {
    const t0 = Date.now()
    try {
      const r = await Promise.race([
        fetch(`https://${svc.host}${svc.path}`),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ])
      return { ...svc, status: r.status, latency: Date.now() - t0, healthy: r.status < 400 }
    } catch {
      return { ...svc, status: 0, latency: Date.now() - t0, healthy: false }
    }
  }))

  // Alert on state transitions
  for (const svc of results) {
    const wasHealthy = _renderHealthState[svc.name]
    _renderHealthState[svc.name] = svc.healthy
    if (wasHealthy === true && !svc.healthy) {
      sendTelegram(`🔴 *Render 服務異常*\n\n*${svc.name}* 無法回應\nHost: \`${svc.host}\`\nStatus: ${svc.status}`).catch(() => {})
      console.warn(`[render] ${svc.name} DOWN`)
    } else if (wasHealthy === false && svc.healthy) {
      sendTelegram(`🟢 *Render 服務恢復*\n\n*${svc.name}* 已恢復正常`).catch(() => {})
      console.log(`[render] ${svc.name} recovered`)
    }
  }

  tickRenderUsage(results)

  _renderCache = { services: results, checkedAt: new Date().toISOString() }
  console.log(`[render] cache refreshed — ${results.filter(s => s.healthy).length}/${results.length} healthy`)
}

// Render health is refreshed ON DEMAND from the /api/admin/status handler (i.e. only
// while someone has the admin dashboard open), NOT on a background timer. A fixed-interval
// poll hits every free service every cycle, which resets Render's 15-min spindown clock and
// keeps the whole fleet awake 24/7 — that silently exhausted the schienbiz 750h workspace
// pool and suspended 2560 / travel / intelligence-journal (2026-06-19). Can-sleep apps
// should be allowed to sleep; we only probe them when a human is actually watching.
let _renderRefreshInFlight = false
function maybeRefreshRenderCache() {
  if (_renderRefreshInFlight) return
  const ageMs = _renderCache.checkedAt ? Date.now() - new Date(_renderCache.checkedAt) : Infinity
  if (ageMs < 60_000) return            // throttle: at most one upstream poll per 60s
  _renderRefreshInFlight = true
  refreshRenderCache()
    .catch(e => console.error('[render] refresh error:', e.message))
    .finally(() => { _renderRefreshInFlight = false })
}

// ── Render authoritative state (via Render API, per-workspace key) ──────────────
// Unlike the HTTP probe above, this hits api.render.com (NOT the service URLs), so it
// NEVER wakes a free service and is safe to run on a background timer. It is the only
// source of *authoritative* suspension state + reason (`suspenders`), e.g. 'billing' =
// the workspace's free 750h pool is exhausted. (Render's API exposes no consumed-hours
// figure, so this state is what catches a pool blow-out — not an hours number.)
const RENDER_API_KEYS = {
  schienbiz:    process.env.RENDER_API_KEY_SCHIENBIZ,
  smritichain:  process.env.RENDER_API_KEY_SMRITICHAIN,
  atungc2020:   process.env.RENDER_API_KEY_ATUNGC2020,
  pvnetwork2026: process.env.RENDER_API_KEY_PVNETWORK2026,  // 2026-07-02 private-network 遷入獨立帳號隔離常駐 WS 消耗；key 缺時 refreshRenderState 的 if(!key) continue 會優雅跳過，補上 .env 即自動啟用 suspend/deploy/usage 監控（否則此帳號=監控盲點）
}
let _renderApiState = { byHost: {}, services: [], checkedAt: null, errors: [] }
const _renderSuspendState = {}   // host → last seen 'suspended'|'not_suspended' (for transition alerts)
const _renderDeployState = {}    // host → last deploy status (2026-06-20: catch failed deploy w/o keepalive)

async function refreshRenderState() {
  const byHost = {}, all = [], errors = [], idKey = {}
  for (const [ws, key] of Object.entries(RENDER_API_KEYS)) {
    if (!key) continue
    try {
      const r = await Promise.race([
        fetch('https://api.render.com/v1/services?limit=100', { headers: { Authorization: `Bearer ${key}` } }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10_000)),
      ])
      if (!r.ok) { errors.push(`${ws}:${r.status}`); continue }
      for (const it of await r.json()) {
        const s = it.service || it
        const host = (s.serviceDetails?.url || '').replace(/^https?:\/\//, '')
        const rec = { name: s.name, host, workspace: ws, id: s.id, suspended: s.suspended, suspenders: s.suspenders || [], repo: s.repo || null, branch: s.branch || 'main' }
        if (s.id) idKey[s.id] = key
        if (host) byHost[host] = rec
        all.push(rec)
      }
    } catch (e) { errors.push(`${ws}:${e.message}`) }
  }
  // Alert only on transitions (first sighting sets a silent baseline — no boot-time spam for
  // services already suspended).
  for (const rec of all) {
    const prev = _renderSuspendState[rec.host]
    _renderSuspendState[rec.host] = rec.suspended
    if (prev && prev !== 'suspended' && rec.suspended === 'suspended') {
      const why = rec.suspenders.join(',') || 'unknown'
      const poolNote = rec.suspenders.includes('billing')
        ? `\n→ 免費額度耗盡：*${rec.workspace}* workspace 的 750h 池可能已用光（同池其他服務也會一起停，等 1 號 billing reset）`
        : ''
      sendTelegram(`🔴 *Render 服務已暫停*\n\n*${rec.name}* (${rec.workspace})\n原因：\`${why}\`${poolNote}`).catch(() => {})
      console.warn(`[render-api] ${rec.name} SUSPENDED (${why})`)
    } else if (prev === 'suspended' && rec.suspended === 'not_suspended') {
      sendTelegram(`🟢 *Render 服務已恢復*\n\n*${rec.name}* (${rec.workspace}) 已解除暫停`).catch(() => {})
      console.log(`[render-api] ${rec.name} resumed`)
    }
  }
  // Deploy-status 檢查（補「後端 deploy 失敗跑不起來」盲點，非 keepalive：打 Render API 不喚醒服務）。
  // 只查非 suspended（suspended 已另告警）。轉態進入失敗狀態才發 Telegram。2026-06-20。
  const BAD_DEPLOY = /failed|canceled/i
  await Promise.all(all.filter(r => r.id && r.suspended !== 'suspended').map(async (rec) => {
    const key = idKey[rec.id]
    if (!key) return
    try {
      const r = await Promise.race([
        fetch(`https://api.render.com/v1/services/${rec.id}/deploys?limit=1`, { headers: { Authorization: `Bearer ${key}` } }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
      ])
      if (!r.ok) return
      const arr = await r.json()
      const dep = (arr[0] && (arr[0].deploy || arr[0])) || {}
      const status = dep.status || ''
      rec.deployStatus = status
      rec.deployedCommit = dep.commit?.id || null
      const prev = _renderDeployState[rec.host]
      _renderDeployState[rec.host] = status
      if (prev && prev !== status && BAD_DEPLOY.test(status) && !BAD_DEPLOY.test(prev)) {
        sendTelegram(`🔴 *Render deploy 失敗*\n\n*${rec.name}* (${rec.workspace})\n最新 deploy：\`${status}\`\n→ 服務可能跑不起來（非 suspend；後端可睡不能 ping，health poll 看不到）。查 Render dashboard logs。`).catch(() => {})
        console.warn(`[render-api] ${rec.name} deploy ${status}`)
      }
    } catch { /* deploy 查詢 best-effort */ }
  }))
  _renderApiState = { byHost, services: all, checkedAt: new Date().toISOString(), errors }
  // Accumulate REAL awake-hours + fire pool-usage alerts from authoritative metrics (best-effort;
  // must never break state refresh). This is what would have caught line-expense-bot at 70%.
  await tickRenderUsageFromMetrics(all, idKey).catch(e => console.error('[render-usage] metrics tick error:', e.message))
  const susp = all.filter(s => s.suspended === 'suspended').length
  console.log(`[render-api] state refreshed — ${susp}/${all.length} suspended${errors.length ? ` (errors: ${errors.join(' ')})` : ''}`)
}
// Safe to poll on a timer (hits the API, not the services). Warm once on startup so the
// dashboard + alert baseline are ready immediately; refresh every 5 min thereafter.
if (Object.values(RENDER_API_KEYS).some(Boolean)) {
  refreshRenderState().catch(e => console.error('[render-api] startup error:', e.message))
  setInterval(() => refreshRenderState().catch(e => console.error('[render-api] error:', e.message)), 5 * 60_000)
} else {
  console.warn('[render-api] no RENDER_API_KEY_* set — authoritative suspension state disabled')
}

// Commit-drift ALERTING moved out (2026-07-01) → `~/commit-drift-scan.py` LaunchAgent on ATung Mac.
// Rationale: full coverage needs per-org GitHub tokens for cross-org PRIVATE repos, and embedding
// write-scoped PATs into this internet-exposed service is a poor security trade. The local scanner
// reads the gh keyring's 3 org tokens at runtime (never persisted, never on the exposed host) and
// covers all 10 services. Keeping an in-process checker here too would double-alert on public repos.
// (rec.deployedCommit is still captured in the deploy-status loop above for the dashboard.)

// ── API Key Vault ─────────────────────────────────────────────────────────────
const VAULT_PATH = path.join(__dirname, '../data/vault.json')

function _vaultKey() {
  const k = process.env.VAULT_KEY
  if (!k || k.length < 64) return null
  return Buffer.from(k.slice(0, 64), 'hex')
}

function encryptVaultValue(plain) {
  const key = _vaultKey()
  if (!key) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('hex'), enc.toString('hex'), tag.toString('hex')].join('.')
}

function decryptVaultValue(enc) {
  const key = _vaultKey()
  if (!key || !enc) return null
  try {
    const [ivHex, encHex, tagHex] = enc.split('.')
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8')
  } catch { return null }
}

function loadVault() {
  try { return JSON.parse(fs.readFileSync(VAULT_PATH, 'utf-8')) } catch { return [] }
}

function saveVault(entries) {
  fs.mkdirSync(path.dirname(VAULT_PATH), { recursive: true })
  fs.writeFileSync(VAULT_PATH, JSON.stringify(entries, null, 2))
}

app.get('/api/admin/vault', requireAdmin, (req, res) => {
  const entries = loadVault().map(e => {
    const plain = decryptVaultValue(e.encryptedValue)
    return {
      name: e.name,
      description: e.description,
      expiry: e.expiry || null,
      maskedValue: plain ? `••••${plain.slice(-4)}` : (e.encryptedValue ? '••••[encrypted]' : null),
      addedAt: e.addedAt,
      updatedAt: e.updatedAt,
      project: e.project || 'Other',
      expiryWarning: e.expiry ? daysUntil(e.expiry) <= 7 : false,
    }
  })
  res.json({ entries, vaultKeySet: !!_vaultKey() })
})

function daysUntil(isoDate) {
  return Math.floor((new Date(isoDate) - Date.now()) / 86_400_000)
}

app.post('/api/admin/vault', requireAdmin, (req, res) => {
  const { name, description, expiry, value, project } = req.body
  if (!name || !/^[A-Za-z0-9_\-. ]+$/.test(name)) return res.status(400).json({ error: 'Invalid name' })
  const entries = loadVault()
  const now = new Date().toISOString()
  const idx = entries.findIndex(e => e.name === name)
  const entry = {
    name: name.trim(),
    description: description?.trim() || '',
    expiry: expiry || null,
    project: project || (idx >= 0 ? entries[idx].project : 'Other'),
    encryptedValue: value ? encryptVaultValue(value) : (idx >= 0 ? entries[idx].encryptedValue : null),
    addedAt: idx >= 0 ? entries[idx].addedAt : now,
    updatedAt: now,
  }
  if (idx >= 0) entries[idx] = entry
  else entries.push(entry)
  saveVault(entries)
  console.log(`[vault] upserted key: ${entry.name}`)
  res.json({ ok: true, name: entry.name })
})

app.delete('/api/admin/vault/:name', requireAdmin, (req, res) => {
  const name = decodeURIComponent(req.params.name)
  const entries = loadVault().filter(e => e.name !== name)
  saveVault(entries)
  console.log(`[vault] deleted key: ${name}`)
  res.json({ ok: true })
})

app.get('/api/admin/vault/:name/reveal', requireAdmin, (req, res) => {
  const name = decodeURIComponent(req.params.name)
  const entry = loadVault().find(e => e.name === name)
  if (!entry) return res.status(404).json({ error: 'not found' })
  const value = decryptVaultValue(entry.encryptedValue)
  console.log(`[vault] revealed key: ${name}`)
  res.json({ value })
})

app.post('/api/admin/render/refresh', requireAdmin, (req, res) => {
  refreshRenderCache().catch(e => console.error('[render] force-refresh error:', e.message))
  res.json({ ok: true })
})

// Tune usage cap + alert thresholds from the admin UI. thresholdsPct = integer percentages.
app.post('/api/admin/render/usage/config', requireAdmin, (req, res) => {
  const next = { capHours: _renderUsageConfig.capHours, thresholds: _renderUsageConfig.thresholds }
  if (req.body?.capHours != null) next.capHours = Number(req.body.capHours)
  if (Array.isArray(req.body?.thresholdsPct)) next.thresholds = req.body.thresholdsPct.map(n => Number(n) / 100)
  _renderUsageConfig = normalizeUsageConfig(next)
  saveRenderUsageConfig()
  // re-evaluate immediately so a newly-lowered threshold can alert without waiting 60s
  checkUsageThresholds()
  saveRenderUsage()
  console.log(`[render-usage] config updated: cap=${_renderUsageConfig.capHours}h thresholds=${_renderUsageConfig.thresholds.join(',')}`)
  res.json({ ok: true, config: usageConfigPublic() })
})

// ── DB storage usage (Neon 0.5GB / CockroachDB free caps) ───────────────────────
// Silent cliff: a full DB fails writes with no warning. self-journal stores photos
// as base64 in Neon, so its DB grows fastest. Shares alert thresholds with the
// Render budget (_renderUsageConfig.thresholds). source 'env' = AI-PM's own DB;
// 'vault:KEY' = decrypt a DATABASE_URL from the key vault.
const DB_MONITORS = [
  { name: 'AI PM',           source: 'env' },
  { name: '2560戰法',         source: 'vault:DATABASE_URL_2560' },
  { name: 'Voice Trainer',   source: 'vault:VOICE_DATABASE_URL' },
  { name: 'Relationship OS', source: 'vault:DATABASE_URL_ROS' },
  { name: 'Private Network', source: 'vault:DATABASE_URL_PRIVATE_NETWORK' },
  { name: 'Leave Bot',       source: 'vault:DATABASE_URL_LEAVE_BOT' },
  { name: 'Self-Journal',    source: 'vault:DATABASE_URL_SELF_JOURNAL' },   // 2026-06-20 納管：base64 照片存 Neon = 最會撐爆儲存的，先前漏監控
  { name: 'Warehouse',       source: 'vault:DATABASE_URL_WAREHOUSE' },      // 2026-06-20 納管
]
// Provider classified from connection host (different free caps). CockroachDB has no
// SQL size function → those rows show N/A and never alert; the cliff that matters is
// Neon's 0.5GB (self-journal base64 photos).
const DB_CAP_BYTES = { neon: 512 * 1024 * 1024, crdb: 10 * 1024 * 1024 * 1024, pg: 512 * 1024 * 1024 }
function classifyDb(host) {
  if (/cockroachlabs\.cloud|crdb|cockroach/i.test(host)) return 'crdb'
  if (/neon\.tech|\.neon\./i.test(host)) return 'neon'
  return 'pg'
}

function fmtBytes(n) {
  if (n == null) return '—'
  const mb = n / 1048576
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)}GB` : `${Math.round(mb)}MB`
}

function resolveDbUrl(source) {
  if (source === 'env') return process.env.DATABASE_URL || null
  if (source.startsWith('vault:')) {
    const entry = loadVault().find(e => e.name === source.slice(6))
    return entry ? decryptVaultValue(entry.encryptedValue) : null
  }
  return null
}

async function checkDbSize(connStr) {
  const u = new URL(connStr)
  u.searchParams.delete('sslmode')   // pg driver's sslmode would override our ssl object
  const client = new pg.Client({
    connectionString: u.toString(),
    ssl: { rejectUnauthorized: false },   // read-only size query across mixed providers
    connectionTimeoutMillis: 8000,
    query_timeout: 8000,
  })
  try {
    await client.connect()
    const { rows } = await client.query('SELECT pg_database_size(current_database()) AS bytes')
    return Number(rows[0].bytes)
  } finally {
    await client.end().catch(() => {})
  }
}

let _dbUsageCache = { dbs: [], checkedAt: null }
const _dbAlertState = {}   // { name: highestThresholdFraction fired } — gauge w/ hysteresis
const _dbComputeAlertState = {}   // { name: bool } — Neon compute-quota-exhausted alert dedup (2026-06-20 ROS 事故後新增)

async function refreshDbUsage() {
  const dbs = await Promise.all(DB_MONITORS.map(async (m) => {
    const connStr = resolveDbUrl(m.source)
    if (!connStr) return { name: m.name, kind: '?', configured: false, bytes: null, capDisplay: '—' }
    const kind = classifyDb(new URL(connStr).host)
    const capBytes = DB_CAP_BYTES[kind]
    const base = { name: m.name, kind, capBytes, capDisplay: fmtBytes(capBytes), configured: true }
    try {
      const bytes = await Promise.race([
        checkDbSize(connStr),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 9000)),
      ])
      const frac = bytes / capBytes
      return { ...base, bytes, usedDisplay: fmtBytes(bytes), pct: Math.round(frac * 1000) / 10, level: usageLevel(frac) }
    } catch (e) {
      // CockroachDB has no pg_database_size → surface as N/A, not an error (never alerts)
      if (/unknown function|pg_database_size|does not exist/i.test(e.message)) {
        return { ...base, bytes: null, sizeUnavailable: true }
      }
      // Neon free COMPUTE 配額耗盡 (XX000) — 真正會釀停機的指標（儲存量仍小=綠，但 app 連不上 DB）。
      // 2026-06-20 ROS 事故根因：監控只盯儲存(pg_database_size)，看不到 compute 耗盡 → 靜默。現在偵測並告警。
      if (/compute time quota|exceeded the compute|quota.*exceed/i.test(e.message)) {
        return { ...base, bytes: null, computeQuotaExceeded: true, error: e.message }
      }
      return { ...base, bytes: null, error: e.message }
    }
  }))

  // gauge alerts: fire when crossing up into a higher band; reset when it drops
  for (const d of dbs) {
    if (d.bytes == null) continue
    const frac = d.bytes / d.capBytes
    const crossed = _renderUsageConfig.thresholds.filter(t => frac >= t)
    const top = crossed.length ? Math.max(...crossed) : 0
    if (top > (_dbAlertState[d.name] || 0)) {
      sendTelegram(`⚠️ *DB 儲存用量警告*\n\n*${d.name}* (${d.kind}) 已用 *${d.usedDisplay} / ${d.capDisplay}* (${d.pct}%)\n跨過 ${Math.round(top * 100)}% 門檻。\n滿了會寫入失敗${d.kind === 'neon' ? '（Neon free 0.5GB）' : '（CRDB free）'}。`).catch(() => {})
      console.warn(`[db-usage] ${d.name} crossed ${Math.round(top * 100)}% (${d.usedDisplay}/${d.capDisplay})`)
    }
    _dbAlertState[d.name] = top   // store current band so a drop-then-recross re-alerts
  }

  // Neon compute-quota 告警（補儲存盲點）：compute 耗盡時儲存 gauge 仍綠、app 卻連不上 DB。
  // 在 exhausted 轉態時發 Telegram，確認可連線(bytes!=null)時發恢復；transient error 不動狀態。
  for (const d of dbs) {
    if (!d.configured) continue
    if (d.computeQuotaExceeded) {
      if (!_dbComputeAlertState[d.name]) {
        sendTelegram(`🔴 *Neon compute 配額耗盡*\n\n*${d.name}* 的 Neon 免費 compute 月配額已用完 → app 無法連 DB（注意：儲存量正常不代表沒事，這是另一個配額）。\n常見原因：24/7 keepalive/輪詢把 compute 釘醒。\n→ 等月配額重置、降輪詢頻率、或搬 CockroachDB / 付費。`).catch(() => {})
        console.warn(`[db-usage] ${d.name} Neon COMPUTE quota EXHAUSTED`)
      }
      _dbComputeAlertState[d.name] = true
    } else if (d.bytes != null) {   // 查得到 size = compute 可連 = 恢復
      if (_dbComputeAlertState[d.name]) {
        sendTelegram(`🟢 *Neon compute 恢復*\n\n*${d.name}* 的 Neon compute 已可連線（配額重置或恢復）。`).catch(() => {})
        console.log(`[db-usage] ${d.name} Neon compute recovered`)
      }
      _dbComputeAlertState[d.name] = false
    }
    // else: bytes null 但非 compute 耗盡（timeout 等 transient）→ 不動狀態，避免假恢復/假告警
  }

  _dbUsageCache = { dbs, checkedAt: new Date().toISOString() }
  console.log(`[db-usage] refreshed — ${dbs.filter(d => d.bytes != null).length}/${dbs.length} measured`)
}

// Storage moves slowly + each Neon connect wakes the compute (burns compute-hours),
// so poll every 6h; manual refresh available. Warm 20s after boot.
setInterval(() => refreshDbUsage().catch(e => console.error('[db-usage] refresh error:', e.message)), 6 * 3600_000)
setTimeout(() => refreshDbUsage().catch(() => {}), 20_000)

app.post('/api/admin/db-usage/refresh', requireAdmin, (req, res) => {
  refreshDbUsage().catch(e => console.error('[db-usage] force-refresh error:', e.message))
  res.json({ ok: true })
})

// ── Cloudinary usage (warehouse-scanner — ~25 credits/mo) ───────────────────────
// Activates when CLOUDINARY_URL (cloudinary://key:secret@cloud) is in the vault.
function getCloudinaryCreds() {
  const entry = loadVault().find(e => e.name === 'CLOUDINARY_URL')
  if (!entry) return null
  try {
    const u = new URL(decryptVaultValue(entry.encryptedValue))
    return { apiKey: u.username, apiSecret: u.password, cloudName: u.hostname }
  } catch { return null }
}

let _cloudinaryUsage = { configured: false, checkedAt: null }
let _cloudinaryAlerted = 0

async function refreshCloudinaryUsage() {
  const c = getCloudinaryCreds()
  if (!c) { _cloudinaryUsage = { configured: false, checkedAt: new Date().toISOString() }; return }
  try {
    const auth = Buffer.from(`${c.apiKey}:${c.apiSecret}`).toString('base64')
    const r = await Promise.race([
      fetch(`https://api.cloudinary.com/v1_1/${c.cloudName}/usage`, { headers: { Authorization: `Basic ${auth}` } }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 9000)),
    ])
    const j = await r.json()
    const used = j.credits?.usage ?? null
    const limit = j.credits?.limit ?? null
    const frac = (used != null && limit) ? used / limit
      : (j.credits?.used_percent != null ? j.credits.used_percent / 100 : null)
    _cloudinaryUsage = {
      configured: true, cloudName: c.cloudName, used, limit,
      pct: frac != null ? Math.round(frac * 1000) / 10 : null,
      level: frac != null ? usageLevel(frac) : null,
      storageDisplay: fmtBytes(j.storage?.usage), bandwidthDisplay: fmtBytes(j.bandwidth?.usage),
      checkedAt: new Date().toISOString(),
    }
    if (frac != null) {
      const crossed = _renderUsageConfig.thresholds.filter(t => frac >= t)
      const top = crossed.length ? Math.max(...crossed) : 0
      if (top > _cloudinaryAlerted) {
        sendTelegram(`⚠️ *Cloudinary 用量警告*\n\nWarehouse Scanner 圖庫 credits 已用 *${_cloudinaryUsage.pct}%* (${used}/${limit})\n跨過 ${Math.round(top * 100)}% 門檻。\n用光 → 上傳/轉換 403，掃描流程中斷。`).catch(() => {})
        console.warn(`[cloudinary] crossed ${Math.round(top * 100)}%`)
      }
      _cloudinaryAlerted = top
    }
  } catch (e) {
    _cloudinaryUsage = { configured: true, error: e.message, checkedAt: new Date().toISOString() }
  }
}

setInterval(() => refreshCloudinaryUsage().catch(e => console.error('[cloudinary] refresh error:', e.message)), 3600_000)
setTimeout(() => refreshCloudinaryUsage().catch(() => {}), 23_000)

// ─── External watchdog heartbeat (Healthchecks.io dead-man's switch) ──────────
// Push 模型：chusMBp 每 60s 往外送心跳。整台睡死/斷網/AI-PM crash → 心跳停 →
// Healthchecks.io 寄 Email 告警。AI-PM 不對外開端點(留 Tailscale 私網，零曝露)，
// 補「監控中心自己掛了沒人知」破口。URL 缺省則完全 inert(守門)。見 hosting docs。
// Check-1 aipm：此 interval 會 fire = AI-PM 進程 + 事件迴圈活著。獨立計時，不耦合
//   render-api 迴圈(否則 Render API 掛時會假告警)。
// Check-2 ros：ROS 是 selfbot 無 HTTP /health → 改查 launchd 進程 PID 存活。
function pingHeartbeat(url) {
  if (!url) return
  fetch(url, { method: 'GET' }).catch(() => {})   // fire-and-forget；HC 只看收到與否
}
setInterval(() => pingHeartbeat(process.env.HC_PING_URL_AIPM), 60_000)
setInterval(() => {
  const url = process.env.HC_PING_URL_ROS
  if (!url) return
  // ROS 健康判斷用「3000 是否 listen」(TCP 探測)：ROS 的 HTTP server 只在 DB 連上後才 bind 3000，
  // 故 port-listening = 過了 DB init = 真服務中。
  // ⚠️ 刻意【不】用 launchd PID(DB 掛時進程仍在=假綠，2026-06-20 Neon 耗盡事故踩過)，
  // 也【不】用 HTTP /health(它內部 SELECT 1 會把 Neon compute 釘醒 → 變成新的 60s keepalive，
  // 正是燒爆 ROS Neon 免費 compute 配額的元兇)。TCP connect 不觸發 /health 故不碰 Neon。
  try { execSync('nc -z -w 2 localhost 3000', { timeout: 4000 }); pingHeartbeat(url) }
  catch { /* 3000 沒 listen → ROS 未服務 → 不 ping → HC grace 過後 Email 告警 */ }
}, 60_000)
console.log('[heartbeat] watchdog interval armed (aipm:%s ros:%s)',
  process.env.HC_PING_URL_AIPM ? 'on' : 'off', process.env.HC_PING_URL_ROS ? 'on' : 'off')

// ─── Watchdog self-monitor (2026-06-20) ───────────────────────────────────────
// ~/watchdog.sh 重啟所有 chusMBp 服務，但它自己沒人看：它死了→服務掛掉不再自動重啟、無告警。
// watchdog 每次跑(StartInterval 300s)寫 /tmp/watchdog-hb (epoch 秒)；AI-PM 查其新鮮度，
// >12min(2+ 個週期沒更新)= watchdog 死了 → 告警。檔不存在=還沒跑過(開機寬限)，不告警。
let _watchdogStaleAlerted = false
setInterval(() => {
  let hb
  try { hb = parseInt(fs.readFileSync('/tmp/watchdog-hb', 'utf-8').trim(), 10) } catch { return }
  if (!Number.isFinite(hb)) return
  const ageSec = Date.now() / 1000 - hb
  if (ageSec > 720) {
    if (!_watchdogStaleAlerted) {
      sendTelegram(`🔴 *Watchdog 沒在跑*\n\nchusMBp 的 ~/watchdog.sh 已 *${Math.round(ageSec / 60)} 分鐘*沒心跳 → 服務掛掉不會自動重啟。檢查 \`com.chusmbp.watchdog\` LaunchAgent。`).catch(() => {})
      console.warn(`[watchdog-monitor] STALE ${Math.round(ageSec)}s`)
      _watchdogStaleAlerted = true
    }
  } else if (_watchdogStaleAlerted) {
    sendTelegram(`🟢 *Watchdog 恢復*\n\n~/watchdog.sh 心跳恢復正常。`).catch(() => {})
    _watchdogStaleAlerted = false
  }
}, 5 * 60_000)

app.post('/api/admin/cloudinary/refresh', requireAdmin, (req, res) => {
  refreshCloudinaryUsage().catch(e => console.error('[cloudinary] force-refresh error:', e.message))
  res.json({ ok: true })
})

app.get('/api/admin/status', requireAdmin, async (req, res) => {
  // Dashboard is open (this endpoint is only polled by AdminDashboard) → kick a lazy,
  // non-blocking render-health refresh. Self-throttled to ≤1 upstream poll/60s and skipped
  // entirely when nobody is watching, so it never becomes a 24/7 keepalive (see maybeRefreshRenderCache).
  maybeRefreshRenderCache()

  // Local services: fast localhost polls (≤4s timeout, run in parallel)
  const services = await Promise.all(ADMIN_SERVICES.map(async (svc) => {
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
  }))

  // ATung Mac services: polled via Tailscale (5s timeout — cross-machine)
  const atungServices = await Promise.all(ATUNG_SERVICES.map(async (svc) => {
    const t0 = Date.now()
    try {
      const r = await Promise.race([
        fetch(`http://${svc.host}:${svc.port}${svc.path}`),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ])
      return { ...svc, status: r.status, latency: Date.now() - t0, healthy: r.status < 400 }
    } catch {
      return { ...svc, status: 0, latency: Date.now() - t0, healthy: false }
    }
  }))

  let watchdogLines = ['no log']
  try {
    const allLines = fs.readFileSync('/tmp/watchdog.log', 'utf-8').trim().split('\n').filter(Boolean)
    if (allLines.length) watchdogLines = allLines.slice(-3).reverse()
  } catch {}

  // Syncthing: query local daemon for ATung peer connection + sync completion
  let syncthing = { connected: null, completion: null, needBytes: null }
  const ST_KEY = 'g5qXES6Crim3epmQdi4AY7DAFDgHgSYW'
  const ST_PEER = '2ZVPGNB-EG7JGNQ-RTK27QR-3OQMQMZ-JDBFITZ-IAI6JLD-O6CVF6Q-OBGD7Q3'
  try {
    const [connRes, compRes] = await Promise.all([
      fetch('http://localhost:8384/rest/system/connections', { headers: { 'X-API-Key': ST_KEY }, signal: AbortSignal.timeout(2000) }),
      fetch(`http://localhost:8384/rest/db/completion?device=${ST_PEER}`, { headers: { 'X-API-Key': ST_KEY }, signal: AbortSignal.timeout(2000) }),
    ])
    const connData = await connRes.json()
    const compData = await compRes.json()
    const peer = connData.connections?.[ST_PEER]
    syncthing = {
      connected: peer?.connected ?? false,
      address: peer?.address ?? null,
      completion: compData.completion ?? null,
      needBytes: compData.needBytes ?? null,
    }
  } catch { /* Syncthing unreachable — leave defaults */ }

  const ts = Date.now()
  res.json({
    services,
    atungServices,
    // Render: serve cached probe results instantly — refresh is triggered lazily above (only
    // while the dashboard is open), so renderCacheAge can be large/null when reopened after idle.
    // Each service is augmented with authoritative suspension state from the Render API.
    renderServices: _renderCache.services.map(s => {
      const api = _renderApiState.byHost[s.host]
      return api ? { ...s, suspended: api.suspended, suspenders: api.suspenders } : s
    }),
    renderCacheAge: _renderCache.checkedAt ? Math.floor((ts - new Date(_renderCache.checkedAt)) / 1000) : null,
    // Authoritative state for the whole fleet (includes services not in the probe list, e.g. line-expense-bot).
    renderApi: { checkedAt: _renderApiState.checkedAt, services: _renderApiState.services, errors: _renderApiState.errors },
    renderUsage: { month: _renderUsage.month, capHours: _renderUsageConfig.capHours, config: usageConfigPublic(), workspaces: renderUsageSummary() },
    dbUsage: { dbs: _dbUsageCache.dbs, checkedAt: _dbUsageCache.checkedAt },
    cloudinaryUsage: _cloudinaryUsage,
    providers: PROVIDERS.map(p => {
      const coolUntil = _cooldown[p.name]
      const coolingDown = !!(coolUntil && ts < coolUntil)
      const stats = _providerStats[p.name] ?? { ok: 0, err: 0, lastUsed: null }
      return { name: p.name, model: p.model, coolingDown, cooldownUntil: coolingDown ? new Date(coolUntil).toISOString() : null, stats }
    }),
    watchdog: { lastLine: watchdogLines[0], lines: watchdogLines, hbAgeSec: (() => {
      try { const hb = parseInt(fs.readFileSync('/tmp/watchdog-hb', 'utf-8').trim(), 10); return Number.isFinite(hb) ? Math.round(Date.now() / 1000 - hb) : null } catch { return null }
    })() },
    syncthing,
    digest: { lastDigestAt: _lastDigestAt },
    storage: STORAGE_KIND,
    checkedAt: new Date().toISOString(),
  })
})

app.post('/api/admin/restart', requireAdmin, (req, res) => {
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

// ── AI Agent Optimize ────────────────────────────────────────────────────────
const OPTIMIZE_SYSTEM_PROMPT = `你是 AI 自動化優化系統。只回傳 JSON，不要任何說明。格式：
{
  "actions": [
    {
      "service": "服務名稱 (Voice Trainer / AI Learning Tool / Marketing Asst / AI PM)",
      "provider": "Provider 名稱 (Groq/Cerebras/NVIDIA/Mistral/OpenRouter/Qwen3)",
      "old_model": "目前使用的完整 model ID (必須完全符合程式碼中的字串)",
      "new_model": "要更新到的完整 model ID",
      "reason": "一句話說明原因"
    }
  ],
  "skip_reason": "如果沒有需要更新的項目，填原因；否則填空字串"
}
服務名稱必須完全符合上述選項之一。只包含有明確改善效果且確定正確的更新。`

const OPTIMIZABLE_SERVICES = [
  { name: 'Voice Trainer',    file: `${homedir()}/CloudSync/voice-trainer/server/index.js`,        label: 'com.voice-trainer',           selfRestart: false },
  { name: 'AI Learning Tool', file: `${homedir()}/CloudSync/ai-learning-tool/server.js`,           label: 'com.ai-learning-tool.dev',    selfRestart: false },
  { name: 'AI PM',            file: `${homedir()}/CloudSync/ai-project-manager/server/index.js`,   label: 'com.ai-project-manager.dev',  selfRestart: true  },
]

// Preview endpoint — returns parsed actions as JSON without applying anything
app.post('/api/admin/agent-optimize/preview', requireAdmin, async (req, res) => {
  try {
    const { analysisText } = req.body
    if (!analysisText) return res.status(400).json({ error: '缺少分析內容' })

    const planRaw = await multiGenerate([
      { role: 'system', content: OPTIMIZE_SYSTEM_PROMPT },
      { role: 'user', content: `根據以下分析，列出可立即套用的 model 更新。old_model 必須是程式碼中確切存在的字串：\n\n${analysisText}` }
    ], 400)

    let plan = { actions: [], skip_reason: '' }
    try { const m = planRaw.match(/\{[\s\S]*\}/); if (m) plan = JSON.parse(m[0]) } catch { /* ignore */ }
    res.json(plan)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/api/admin/agent-optimize', requireAdmin, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const step = (text) => res.write(`data: ${JSON.stringify({ type: 'step', text })}\n\n`)
  const out  = (text) => res.write(`data: ${JSON.stringify({ type: 'output', text })}\n\n`)
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 10_000)
  let selfRestartNeeded = false

  try {
    const { analysisText, actions: previewedActions } = req.body

    // If caller passes pre-parsed actions (from preview step), skip AI call
    let plan
    if (previewedActions?.length) {
      plan = { actions: previewedActions }
      step(`📋 套用已確認的 ${previewedActions.length} 項計畫...`)
    } else {
      if (!analysisText) { step('❌ 缺少分析內容'); res.write('data: [DONE]\n\n'); return }
      step('🧠 解析優化計畫...')
      const planRaw = await multiGenerate([
        { role: 'system', content: OPTIMIZE_SYSTEM_PROMPT },
        { role: 'user', content: `根據以下分析，列出可立即套用的 model 更新。old_model 必須是程式碼中確切存在的字串：\n\n${analysisText}` },
      ], 400)

      let parsed = { actions: [], skip_reason: '' }
      try {
        const m = planRaw.match(/\{[\s\S]*\}/)
        if (m) parsed = JSON.parse(m[0])
      } catch {
        step('⚠️ 無法解析優化計畫')
        out(planRaw)
        res.write('data: [DONE]\n\n')
        return
      }
      plan = parsed
    }

    if (!plan.actions?.length) {
      out(`✅ 無需自動優化${plan.skip_reason ? '：' + plan.skip_reason : ''}`)
      res.write('data: [DONE]\n\n')
      return
    }

    step(`📋 套用 ${plan.actions.length} 項更新...`)
    const applied = [], skipped = []

    for (const action of plan.actions) {
      const svc = OPTIMIZABLE_SERVICES.find(s => s.name === action.service)
      if (!svc) {
        step(`⏭️ ${action.service}：Render 服務，跳過（需手動更新）`)
        skipped.push(action.service)
        continue
      }
      if (!fs.existsSync(svc.file)) {
        step(`⚠️ ${action.service}：找不到檔案`)
        skipped.push(action.service)
        continue
      }
      if (!action.old_model || action.old_model.length < 5) {
        step(`⚠️ ${action.service}：old_model "${action.old_model}" 太短，跳過（安全防護）`)
        skipped.push(action.service)
        continue
      }
      if (!action.new_model || action.new_model.length < 5) {
        step(`⚠️ ${action.service}：new_model "${action.new_model}" 太短，跳過（安全防護）`)
        skipped.push(action.service)
        continue
      }
      let content = fs.readFileSync(svc.file, 'utf-8')
      if (!content.includes(action.old_model)) {
        step(`⚠️ ${action.service} / ${action.provider}：找不到 "${action.old_model}"，跳過`)
        skipped.push(action.service)
        continue
      }
      const bakPath = svc.file + '.bak'
      fs.writeFileSync(bakPath, content, 'utf-8')
      const updated = content.replaceAll(action.old_model, action.new_model)
      fs.writeFileSync(svc.file, updated, 'utf-8')
      try {
        execSync(`node --check "${svc.file}"`, { timeout: 5000 })
      } catch (e) {
        fs.writeFileSync(svc.file, content, 'utf-8')
        step(`⚠️ ${action.service}：語法錯誤，已還原（${e.message.split('\n')[0]}）`)
        skipped.push(action.service)
        continue
      }
      step(`✅ ${action.service} / ${action.provider}：${action.old_model} → ${action.new_model}`)
      applied.push(svc)
    }

    // Restart affected services (defer self-restart until after SSE ends)
    for (const svc of [...new Map(applied.map(s => [s.label, s])).values()]) {
      if (svc.selfRestart) { selfRestartNeeded = true; step(`♻️ AI PM 將在串流結束後重啟`); continue }
      try {
        execSync(`launchctl kickstart -k gui/501/${svc.label}`, { timeout: 5000 })
        step(`♻️ ${svc.name} 重啟完成`)
      } catch (e) { step(`⚠️ ${svc.name} 重啟失敗：${e.message}`) }
    }

    const summary = [
      applied.length  ? `✅ 已更新 ${applied.length} 項：${applied.map(s => s.name).join('、')}` : null,
      skipped.length  ? `⏭️ 跳過 ${skipped.length} 項：${skipped.join('、')}` : null,
      selfRestartNeeded ? `⚠️ AI PM 已更新，即將重啟（頁面會短暫斷線）` : null,
    ].filter(Boolean).join('\n')
    out(summary)
    res.write('data: [DONE]\n\n')
  } catch (err) {
    step(`❌ 優化失敗：${err.message}`)
    res.write('data: [DONE]\n\n')
  } finally {
    clearInterval(keepAlive)
    res.end()
    if (selfRestartNeeded) {
      setTimeout(() => {
        try { execSync('launchctl kickstart -k gui/501/com.ai-project-manager.dev', { timeout: 5000 }) } catch {}
      }, 1500)
    }
  }
})

// ── AI Agent Analysis ─────────────────────────────────────────────────────────
app.post('/api/admin/agent-analysis', requireAdmin, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const out = (text) => res.write(`data: ${JSON.stringify({ type: 'output', text })}\n\n`)
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 10_000)

  try {
    const ts = Date.now()
    const vaultEntries = loadVault()
    const expiringKeys = vaultEntries.filter(e => e.expiry && daysUntil(e.expiry) <= 30)

    const providerLines = PROVIDERS.map(p => {
      const coolUntil = _cooldown[p.name]
      const coolingDown = !!(coolUntil && ts < coolUntil)
      const stats = _providerStats[p.name] ?? { ok: 0, err: 0, lastUsed: null }
      const lastUsed = stats.lastUsed ? new Date(stats.lastUsed).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '未使用'
      return `• ${p.name} (${p.model}): ${stats.ok} 成功 / ${stats.err} 失敗，最後使用 ${lastUsed}${coolingDown ? ' ⚠️ cooling down' : ''}`
    }).join('\n')

    const keysByProject = {}
    for (const e of vaultEntries) {
      const proj = e.project || 'Other'
      if (!keysByProject[proj]) keysByProject[proj] = []
      keysByProject[proj].push(e.name)
    }
    const vaultSummary = Object.entries(keysByProject)
      .map(([proj, keys]) => `• ${proj}: ${keys.join(', ')}`)
      .join('\n')

    const expiryWarning = expiringKeys.length
      ? `\n即將到期的 Key (30天內):\n${expiringKeys.map(e => `• ${e.name} — ${daysUntil(e.expiry) < 0 ? '已過期' : `${daysUntil(e.expiry)}天後`}`).join('\n')}`
      : '\n無即將到期的 Key。'

    const prompt = `你是 AI 工程顧問，負責審查以下多專案 AI agent 架構，判斷是否需要更新。

## 當前 AI PM 配置的 Provider（本機 chusMBp）
${providerLines}

## Vault 各專案 API Key 分佈
${vaultSummary}
${expiryWarning}

## 各專案 AI Agent 現況（2026-06 已知）
• **Relationship OS (ROS)**: Groq Qwen3-32b (Blindspot 分析)
• **Intelligence Journal**: Groq Llama4-Scout → Cerebras gpt-oss-120b → NVIDIA Llama3.3-70b → Mistral-large (週報分析，串流)
• **Voice Trainer**: Groq + Cerebras + NVIDIA + Mistral + OpenRouter (5 providers，語音教練)
• **AI Learning Tool**: Groq Scout4 + Qwen3 + Cerebras gather；OpenRouter Llama4-Maverick fallback
• **AI PM**: Groq Scout + Cerebras + Qwen3 + NVIDIA + Mistral (5 providers，PM agents + digest)
• **Marketing Assistant**: Mistral 為主，另有備援
• **2560戰法**: 無 AI agent（純市場訊號）
• **Travel Advisor**: gather-synthesis 架構，多 provider race
• **Private Network**: 無 AI agent

## 分析任務
請依以下結構，給出具體建議：

1. **模型更新建議** — 哪些專案的模型有更好的替代方案？列出具體的 model ID 和理由（考慮速度/成本/能力）
2. **Provider 結構優化** — 哪些專案 provider 配置不夠健壯或有冗餘？
3. **到期 Key 行動** — 需要立即處理的 key 更新
4. **優先順序** — 標出 🔴 立即處理 / 🟡 本週內 / 🟢 可觀察

繁體中文，具體可執行，不超過 400 字。`

    let text = ''
    try {
      text = await multiGenerate([
        { role: 'system', content: '你是 AI 基礎架構顧問，專注於 LLM provider 選型與 agent 架構最佳化。給出具體、可操作的建議。' },
        { role: 'user', content: prompt },
      ], 600)
    } catch (e) {
      text = `分析失敗: ${e.message}`
    }

    const CHUNK = 12
    for (let i = 0; i < text.length; i += CHUNK) out(text.slice(i, i + CHUNK))
    res.write('data: [DONE]\n\n')
  } catch (err) {
    out(`分析失敗: ${err.message}`)
    res.write('data: [DONE]\n\n')
  } finally {
    clearInterval(keepAlive)
    res.end()
  }
})

// ── System Audit ─────────────────────────────────────────────────────────────
app.post('/api/admin/audit', requireAdmin, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const step = (text) => res.write(`data: ${JSON.stringify({ type: 'step', text })}\n\n`)
  const out  = (text) => res.write(`data: ${JSON.stringify({ type: 'output', text })}\n\n`)
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 10_000)

  try {
    step('🔍 Checking local services (chusMBp)...')
    const localResults = await Promise.all(ADMIN_SERVICES.map(async (svc) => {
      const t0 = Date.now()
      try {
        const r = await Promise.race([
          fetch(`http://localhost:${svc.port}${svc.path}`),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
        ])
        const latency = Date.now() - t0
        const healthy = r.status < 400
        step(`${healthy ? '✅' : '❌'} ${svc.name} (:${svc.port}) — ${r.status} (${latency}ms)`)
        return { ...svc, status: r.status, latency, healthy }
      } catch {
        const latency = Date.now() - t0
        step(`❌ ${svc.name} (:${svc.port}) — unreachable`)
        return { ...svc, status: 0, latency, healthy: false }
      }
    }))

    step('🌐 Checking Render services (live)...')
    const renderResults = await Promise.all(RENDER_SERVICES.map(async (svc) => {
      const t0 = Date.now()
      try {
        const r = await Promise.race([
          fetch(`https://${svc.host}${svc.path}`),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000)),
        ])
        const latency = Date.now() - t0
        const healthy = r.status < 400
        step(`${healthy ? '✅' : '❌'} ${svc.name} — ${r.status} (${latency}ms)`)
        return { ...svc, healthy, latency, status: r.status }
      } catch {
        const latency = Date.now() - t0
        step(`❌ ${svc.name} — timeout (${latency}ms)`)
        return { ...svc, healthy: false, latency, status: 0 }
      }
    }))

    step('🤖 Checking AI providers...')
    const ts = Date.now()
    const providerStatus = PROVIDERS.map(p => {
      const coolingDown = !!(p.key && _cooldown[p.name] && ts < _cooldown[p.name])
      const stats = _providerStats[p.name] ?? { ok: 0, err: 0 }
      const icon = !p.key ? '⚪' : coolingDown ? '⚠️' : '✅'
      step(`${icon} ${p.name} — ${!p.key ? 'no key' : coolingDown ? 'cooling down' : `ok (${stats.ok}✓ ${stats.err}✗)`}`)
      return { name: p.name, configured: !!p.key, coolingDown, stats }
    })

    step('🧠 AI analyzing...')
    const localHealthy  = localResults.filter(s => s.healthy).length
    const renderHealthy = renderResults.filter(s => s.healthy).length
    const providersOk   = providerStatus.filter(p => p.configured && !p.coolingDown).length

    const prompt = `系統健康報告 — ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}

本機服務 (chusMBp) — ${localHealthy}/${localResults.length} 正常:
${localResults.map(s => `${s.healthy ? '✅' : '❌'} ${s.name} (:${s.port}): ${s.healthy ? `${s.latency}ms` : 'DOWN'}`).join('\n')}

Render 服務 — ${renderHealthy}/${renderResults.length} 正常:
${renderResults.map(s => `${s.healthy ? '✅' : '❌'} ${s.name}: ${s.healthy ? `${s.latency}ms` : 'DOWN'} (${s.host})`).join('\n')}

AI Provider — ${providersOk}/${providerStatus.length} 可用:
${providerStatus.map(p => `${!p.configured ? '⚪' : p.coolingDown ? '⚠️' : '✅'} ${p.name}: ${!p.configured ? 'no key' : p.coolingDown ? 'cooling down' : `${p.stats.ok} calls, ${p.stats.err} errors`}`).join('\n')}

請提供簡潔評估：
1. **整體狀態** — 🟢正常 / 🟡注意 / 🔴異常，一句話
2. **問題項目** — 不健康的服務與可能原因（全部正常則寫「無」）
3. **建議行動** — 具體下一步（全部正常則寫「無需操作」）

繁體中文，精簡，不超過 150 字。`

    let aiText = ''
    try {
      aiText = await multiGenerate([
        { role: 'system', content: '你是系統監控專家。分析健康報告，提供精簡建議。' },
        { role: 'user', content: prompt },
      ], 400)
    } catch (e) {
      aiText = `AI 分析失敗: ${e.message}`
    }

    const CHUNK = 12
    for (let i = 0; i < aiText.length; i += CHUNK) out(aiText.slice(i, i + CHUNK))
    res.write('data: [DONE]\n\n')
  } catch (err) {
    step(`❌ 稽核失敗: ${err.message}`)
    res.write('data: [DONE]\n\n')
  } finally {
    clearInterval(keepAlive)
    res.end()
  }
})

// ── Marketing module ──────────────────────────────────────────────────────────

const MKTG_DIR = path.join(__dirname, '../data/marketing')
if (!fs.existsSync(MKTG_DIR)) fs.mkdirSync(MKTG_DIR, { recursive: true })

const MKTG_BRAND_FILE     = path.join(MKTG_DIR, 'brand.json')
const MKTG_CAMPAIGNS_FILE = path.join(MKTG_DIR, 'campaigns.json')
const MKTG_HISTORY_FILE   = path.join(MKTG_DIR, 'history.json')

function mktgRead(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return fallback }
}
function mktgWrite(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

function buildBrandContext(brand) {
  if (!brand || !Object.keys(brand).length) return ''
  const lines = []
  if (brand.name)        lines.push(`Brand name: ${brand.name}`)
  if (brand.industry)    lines.push(`Industry: ${brand.industry}`)
  if (brand.tone)        lines.push(`Tone of voice: ${brand.tone}`)
  if (brand.audience)    lines.push(`Target audience: ${brand.audience}`)
  if (brand.values)      lines.push(`Brand values: ${brand.values}`)
  if (brand.keywords)    lines.push(`Key messages / keywords: ${brand.keywords}`)
  if (brand.exampleCopy) lines.push(`Example copy style:\n${brand.exampleCopy}`)
  return `\n\n## Brand Context\n${lines.join('\n')}`
}

const mktgMailer = (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      tls: { rejectUnauthorized: true },
    })
  : null

// send-email is protected by requireAdmin (P0 security fix — can send from Gmail account)
app.post('/api/marketing/send-email', requireAdmin, async (req, res) => {
  if (!mktgMailer) return res.status(503).json({ error: 'Email not configured (GMAIL_USER / GMAIL_APP_PASSWORD missing)' })
  const { to, subject, text, html } = req.body
  if (!to || !subject) return res.status(400).json({ error: 'Missing to or subject' })
  try {
    await mktgMailer.sendMail({ from: process.env.GMAIL_USER, to, subject, text, html })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/marketing/brand', (req, res) => res.json(mktgRead(MKTG_BRAND_FILE, {})))
app.post('/api/marketing/brand', (req, res) => { mktgWrite(MKTG_BRAND_FILE, req.body); res.json({ ok: true }) })

app.get('/api/marketing/campaigns', (req, res) => res.json(mktgRead(MKTG_CAMPAIGNS_FILE, [])))
app.post('/api/marketing/campaigns', (req, res) => {
  const list = mktgRead(MKTG_CAMPAIGNS_FILE, [])
  const item = { ...req.body, id: Date.now().toString(), createdAt: new Date().toISOString() }
  list.unshift(item)
  mktgWrite(MKTG_CAMPAIGNS_FILE, list)
  res.json(item)
})
app.delete('/api/marketing/campaigns/:id', (req, res) => {
  mktgWrite(MKTG_CAMPAIGNS_FILE, mktgRead(MKTG_CAMPAIGNS_FILE, []).filter(c => c.id !== req.params.id))
  res.json({ ok: true })
})

app.get('/api/marketing/history', (req, res) => res.json(mktgRead(MKTG_HISTORY_FILE, [])))
app.post('/api/marketing/history', (req, res) => {
  const list = mktgRead(MKTG_HISTORY_FILE, [])
  const item = { ...req.body, id: Date.now().toString(), createdAt: new Date().toISOString() }
  list.unshift(item)
  if (list.length > 50) list.splice(50)
  mktgWrite(MKTG_HISTORY_FILE, list)
  res.json(item)
})
app.delete('/api/marketing/history/:id', (req, res) => {
  mktgWrite(MKTG_HISTORY_FILE, mktgRead(MKTG_HISTORY_FILE, []).filter(h => h.id !== req.params.id))
  res.json({ ok: true })
})

app.post('/api/marketing/generate', async (req, res) => {
  const { type, topic, platform, tone, length, brief, brand } = req.body
  const brandCtx = buildBrandContext(brand)
  const system = `You are an expert marketing copywriter and content strategist with 15 years of experience across B2B and B2C brands. You write compelling, on-brand content that converts.${brandCtx}`
  const typeInstructions = {
    'social-post':   `Write ${length === 'long' ? '3 variations of' : 'a'} ${platform} post about the topic below. Include relevant hashtags. Keep the tone ${tone || 'engaging and authentic'}.`,
    'blog':          `Write a complete, SEO-optimized blog article about the topic below. Include: headline, meta description, introduction, 3-5 sections with subheadings, and a conclusion with CTA. Tone: ${tone || 'professional and informative'}.`,
    'ad-copy':       `Write ${length === 'long' ? '3 variations of' : 'a'} high-converting ad copy for the topic below. Include: headline, primary text, and CTA. Format for ${platform || 'general digital ads'}. Tone: ${tone || 'direct and persuasive'}.`,
    'email':         `Write a complete marketing email about the topic below. Include: subject line (give 3 options), preview text, greeting, body copy, and CTA button text. Tone: ${tone || 'friendly and professional'}.`,
    'product-desc':  `Write a compelling product description for the topic below. Include: headline, key benefits (as bullet points), full description paragraph, and a CTA. Length: ${length || 'medium'}. Tone: ${tone || 'enthusiastic and clear'}.`,
    'press-release': `Write a professional press release about the topic below. Include: headline, dateline, lead paragraph (who/what/when/where/why), body paragraphs, boilerplate, and contact info placeholder. Tone: formal and newsworthy.`,
  }
  const instruction = typeInstructions[type] || 'Write compelling marketing copy for the topic below.'
  await streamGenerate(res, system, `${instruction}\n\nTopic / Brief:\n${topic || brief}`)
})

app.post('/api/marketing/analyze', async (req, res) => {
  const { data, context, brand } = req.body
  const brandCtx = buildBrandContext(brand)
  const system = `You are a data-driven marketing analyst. You turn raw metrics into clear, actionable insights that non-technical stakeholders can act on immediately.${brandCtx}`
  const userPrompt = `Analyze the following marketing data and provide:
1. **Executive Summary** (2-3 sentences)
2. **Top 3 Wins** — what's working well
3. **Top 3 Issues / Opportunities** — what needs attention
4. **Recommended Actions** — specific next steps with expected impact
5. **Key Metrics to Watch** — what to track going forward

Context: ${context || 'General marketing performance review'}

Raw Data:
\`\`\`
${data}
\`\`\``
  await streamGenerate(res, system, userPrompt)
})

app.post('/api/marketing/plan-campaign', async (req, res) => {
  const { name, goal, audience, budget, startDate, endDate, channels, brand } = req.body
  const brandCtx = buildBrandContext(brand)
  const system = `You are a senior marketing strategist who builds data-driven campaign plans that deliver measurable results.${brandCtx}`
  const userPrompt = `Create a detailed marketing campaign plan with the following parameters:

**Campaign Name:** ${name}
**Goal / Objective:** ${goal}
**Target Audience:** ${audience}
**Budget:** ${budget || 'Not specified'}
**Timeline:** ${startDate} to ${endDate}
**Channels:** ${channels?.join(', ') || 'To be determined'}

Deliver a complete plan including:
1. **Campaign Strategy & Messaging Framework**
2. **Channel Breakdown** — how to allocate effort/budget per channel
3. **Content Calendar** — week-by-week content plan
4. **Key Messages & Hooks** — 3-5 core messages with supporting copy angles
5. **KPIs & Success Metrics** — what to measure and target numbers
6. **Budget Allocation** (if budget provided)
7. **Potential Risks & Mitigation**`
  await streamGenerate(res, system, userPrompt)
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
  // DB unavailable (e.g. CockroachDB monthly RU limit) → warn and continue in
  // degraded mode. DB-dependent routes return 500; the process stays up so the
  // watchdog stops the SSH restart storm and monitoring resumes when DB recovers.
  try {
    await initDb()
  } catch (err) {
    console.warn(`[ai-pm] DB unavailable — degraded mode (DB routes return 500): ${err.message}`)
  }

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
    // No startup render warm: that would wake all free services on every restart (watchdog
    // restarts are frequent) even when nobody is watching. The cache populates lazily on the
    // first /api/admin/status request once a dashboard is opened.
  })
}

// Retry startup up to 5 times with exponential backoff — CockroachDB Serverless
// sometimes returns ETIMEDOUT on the first connection after a pause.
;(async () => {
  let delay = 1000
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await start()
      return
    } catch (err) {
      console.error(`[ai-pm] startup failed (attempt ${attempt}/5): ${err.message ?? err}`)
      if (attempt === 5) { process.exit(1) }
      await new Promise(r => setTimeout(r, delay))
      delay = Math.min(Math.round(delay * 1.5), 10_000)
    }
  }
})()
