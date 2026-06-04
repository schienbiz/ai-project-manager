// One-shot migration: JSON files → CockroachDB
// Usage: DATABASE_URL=... node scripts/migrate-to-cockroachdb.js
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const { Pool } = pg
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '../data')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
})

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return fallback }
}

async function main() {
  const client = await pool.connect()
  try {
    const projects = readJSON(path.join(DATA_DIR, 'projects.json'), [])
    const tasks    = readJSON(path.join(DATA_DIR, 'tasks.json'), [])
    const notes    = readJSON(path.join(DATA_DIR, 'notes.json'), [])
    const digest   = readJSON(path.join(DATA_DIR, 'digest-state.json'), {})

    console.log(`Migrating: ${projects.length} projects, ${tasks.length} tasks, ${notes.length} notes`)

    await client.query('BEGIN')

    for (const p of projects) {
      await client.query(
        `INSERT INTO projects (id,name,description,goal,status,priority,start_date,due_date,tags,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.name || '', p.description || '', p.goal || '',
         p.status || 'active', p.priority || 'medium',
         p.startDate || null, p.dueDate || null,
         JSON.stringify(p.tags || []),
         p.createdAt || new Date().toISOString(),
         p.updatedAt || new Date().toISOString()]
      )
    }
    console.log(`✓ ${projects.length} projects inserted`)

    for (const t of tasks) {
      await client.query(
        `INSERT INTO tasks (id,project_id,title,description,status,priority,estimated_hours,actual_hours,due_date,assignee,tags,sort_order,agent_type,agent_status,agent_output,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (id) DO NOTHING`,
        [t.id, t.projectId, t.title || '', t.description || '',
         t.status || 'todo', t.priority || 'medium',
         t.estimatedHours ?? null, t.actualHours ?? null,
         t.dueDate || null, t.assignee || '',
         JSON.stringify(t.tags || []), t.sortOrder ?? 0,
         t.agentType || null, t.agentStatus || null, t.agentOutput || null,
         t.createdAt || new Date().toISOString(),
         t.updatedAt || new Date().toISOString()]
      )
    }
    console.log(`✓ ${tasks.length} tasks inserted`)

    for (const n of notes) {
      await client.query(
        `INSERT INTO notes (id,project_id,content,ai_extracted,created_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO NOTHING`,
        [n.id, n.projectId, n.content || '',
         JSON.stringify(n.aiExtracted || []),
         n.createdAt || new Date().toISOString()]
      )
    }
    console.log(`✓ ${notes.length} notes inserted`)

    if (digest.lastDigestAt) {
      await client.query(
        'UPDATE digest_state SET last_digest_at=$1 WHERE id=1',
        [digest.lastDigestAt]
      )
      console.log(`✓ digest state restored: ${digest.lastDigestAt}`)
    }

    await client.query('COMMIT')
    console.log('\n✅ Migration complete!')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('❌ Migration failed:', err.message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

main()
