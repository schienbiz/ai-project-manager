import { useState, useEffect, useCallback } from 'react'
import { api } from '../api.js'
import { useLang } from '../i18n.js'

const CATS = ['prd', 'sop', 'meeting', 'risk', 'budget', 'bizplan', 'custom']

// Robust copy: navigator.clipboard needs a secure context (https/localhost). The app is served
// over plain http via the Tailscale hostname, so fall back to a temporary-textarea execCommand.
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.focus(); ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

export default function TemplateLibrary() {
  const { t } = useLang()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [editingId, setEditingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setItems(await api.getTemplates()) } catch { setItems([]) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const onNew = async () => {
    const tpl = await api.createTemplate({ name: '', category: 'custom', body: '' })
    await load()
    setEditingId(tpl.id)
  }

  const cats = new Set(items.map(i => i.category))
  const filtered = filter ? items.filter(i => i.category === filter) : items

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <div className="flex items-center" style={{ gap: 12 }}>
        <h2 style={{ margin: 0 }}>{t.templatesTitle}</h2>
        <button className="btn btn-primary btn-sm ml-auto" onClick={onNew}>{t.tplNew}</button>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>{t.templatesSub}</p>

      <div className="flex items-center" style={{ gap: 8, flexWrap: 'wrap', margin: '14px 0' }}>
        <Chip on={!filter} onClick={() => setFilter('')} label={t.filterAll} />
        {CATS.filter(c => cats.has(c)).map(c => (
          <Chip key={c} on={filter === c} onClick={() => setFilter(c)} label={(t.tplCat && t.tplCat[c]) || c} />
        ))}
      </div>

      {loading ? <div style={{ color: 'var(--muted)' }}>{t.loading}</div>
        : filtered.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t.tplEmpty}</div>
        : filtered.map(tpl => (
            <TemplateCard key={tpl.id} tpl={tpl} t={t}
              editing={editingId === tpl.id}
              onEdit={() => setEditingId(tpl.id)}
              onClose={() => setEditingId(null)}
              onChanged={load} />
          ))}
    </div>
  )
}

function Chip({ on, onClick, label }) {
  return <button className={`btn btn-sm${on ? ' btn-primary' : ''}`} style={{ fontSize: 12 }} onClick={onClick}>{label}</button>
}

function TemplateCard({ tpl, t, editing, onEdit, onClose, onChanged }) {
  const catLabel = (t.tplCat && t.tplCat[tpl.category]) || tpl.category
  const [name, setName] = useState(tpl.name)
  const [category, setCategory] = useState(tpl.category)
  const [body, setBody] = useState(tpl.body)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  // Re-sync local fields when the template changes server-side (save/reseed).
  useEffect(() => { setName(tpl.name); setCategory(tpl.category); setBody(tpl.body) }, [tpl.id, tpl.updatedAt])

  const doCopy = async () => {
    const ok = await copyText(tpl.body)
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500) }
  }
  const save = async () => {
    setSaving(true)
    try { await api.updateTemplate(tpl.id, { name, category, body }); await onChanged(); onClose() }
    finally { setSaving(false) }
  }
  const del = async () => { await api.deleteTemplate(tpl.id); await onChanged() }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
      <div className="flex items-center" style={{ gap: 8, flexWrap: 'wrap' }}>
        {!editing && <strong style={{ fontSize: 14 }}>{tpl.name}</strong>}
        {!editing && <span className="badge" style={{ fontSize: 11, background: 'var(--border)' }}>{catLabel}</span>}
        {!editing && tpl.builtin && <span className="badge" style={{ fontSize: 11 }}>{t.tplBuiltinBadge}</span>}
        <div className="flex items-center" style={{ gap: 6, marginLeft: 'auto' }}>
          <button className="btn btn-sm" style={{ fontSize: 12 }} onClick={doCopy}>{copied ? t.tplCopied : t.tplCopy}</button>
          {!editing && <button className="btn btn-sm" style={{ fontSize: 12 }} onClick={onEdit}>✎</button>}
          {!editing && !tpl.builtin && !confirmDel && (
            <button className="btn btn-sm" style={{ fontSize: 12, color: 'var(--muted)' }} onClick={() => setConfirmDel(true)}>🗑</button>
          )}
          {confirmDel && (
            <>
              <span style={{ fontSize: 11, color: 'var(--danger, #ef4444)' }}>{t.tplDeleteConfirm}</span>
              <button className="btn btn-sm" style={{ fontSize: 12, color: 'var(--danger, #ef4444)' }} onClick={del}>✓</button>
              <button className="btn btn-sm" style={{ fontSize: 12 }} onClick={() => setConfirmDel(false)}>×</button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="form-row">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>{t.tplNameLabel}</label>
              <input value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>{t.tplCategoryLabel}</label>
              <select value={category} onChange={e => setCategory(e.target.value)} disabled={tpl.builtin}>
                {CATS.map(c => <option key={c} value={c}>{(t.tplCat && t.tplCat[c]) || c}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>{t.tplBodyLabel}</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={14}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12.5, minHeight: 240, lineHeight: 1.5 }} />
          </div>
          <div className="flex items-center" style={{ gap: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>{t.tplSave}</button>
            <button className="btn btn-sm" onClick={onClose}>{t.close}</button>
          </div>
        </div>
      ) : (
        <pre style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflow: 'hidden', fontFamily: 'inherit' }}>
          {tpl.body.slice(0, 300)}{tpl.body.length > 300 ? '…' : ''}
        </pre>
      )}
    </div>
  )
}
