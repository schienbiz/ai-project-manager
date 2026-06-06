import { useState, useEffect, useRef } from 'react'
import { useLang } from '../i18n.js'

const STATUS_DOT = { active: '🟢', paused: '⏸️', completed: '✅', archived: '📦' }

export default function CommandPalette({ projects, tasks, onSelectProject, onNewProject, onClose }) {
  const { t } = useLang()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const q = query.trim().toLowerCase()

  const items = q
    ? [
        ...projects
          .filter(p => p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q))
          .slice(0, 5)
          .map(p => ({ type: 'project', id: p.id, label: p.name, hint: p.status, icon: STATUS_DOT[p.status] || '📁' })),
        ...tasks
          .filter(tk => tk.title.toLowerCase().includes(q))
          .slice(0, 6)
          .map(tk => {
            const proj = projects.find(p => p.id === tk.projectId)
            return { type: 'task', id: tk.id, label: tk.title, hint: proj?.name, icon: '✅', projectId: tk.projectId }
          }),
      ]
    : [
        { type: 'action', id: 'new-project', label: t.cmdNewProject, hint: t.cmdNewProjectHint, icon: '⚡' },
        ...projects.slice(0, 7).map(p => ({ type: 'project', id: p.id, label: p.name, hint: p.status, icon: STATUS_DOT[p.status] || '📁' })),
      ]

  const handleSelect = (item) => {
    if (item.type === 'project') onSelectProject(item.id)
    else if (item.type === 'task') onSelectProject(item.projectId)
    else if (item.id === 'new-project') onNewProject()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, items.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)) }
    if (e.key === 'Enter' && items[selected]) handleSelect(items[selected])
  }

  const groups = q
    ? [
        { label: t.cmdProjects, items: items.filter(i => i.type === 'project') },
        { label: t.cmdTasks,    items: items.filter(i => i.type === 'task') },
      ].filter(g => g.items.length > 0)
    : [
        { label: t.cmdActions,  items: items.filter(i => i.type === 'action') },
        { label: t.cmdProjects, items: items.filter(i => i.type === 'project') },
      ]

  let cursor = 0

  return (
    <div className="cmd-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="cmd-palette">
        <div className="cmd-input-wrap">
          <span className="cmd-input-icon">🔍</span>
          <input
            ref={inputRef}
            className="cmd-input"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0) }}
            onKeyDown={handleKeyDown}
            placeholder={t.cmdPlaceholder}
          />
          <kbd className="cmd-key">Esc</kbd>
        </div>

        <div className="cmd-results">
          {items.length === 0 && q && (
            <div className="cmd-empty">{t.cmdNoResults(query)}</div>
          )}
          {groups.map(group => (
            group.items.length > 0 && (
              <div key={group.label}>
                <div className="cmd-group-label">{group.label}</div>
                {group.items.map(item => {
                  const idx = cursor++
                  return (
                    <div
                      key={`${item.type}-${item.id}`}
                      className={`cmd-item${idx === selected ? ' selected' : ''}`}
                      onClick={() => handleSelect(item)}
                      onMouseEnter={() => setSelected(idx)}
                    >
                      <span className="cmd-item-icon">{item.icon}</span>
                      <span className="cmd-item-text">{item.label}</span>
                      {item.hint && <span className="cmd-item-hint">{item.hint}</span>}
                    </div>
                  )
                })}
              </div>
            )
          ))}
        </div>

        <div className="cmd-footer">
          <span><kbd className="cmd-key">↑↓</kbd> {t.cmdNavHint}</span>
          <span><kbd className="cmd-key">↵</kbd> {t.cmdOpenHint}</span>
          <span><kbd className="cmd-key">Esc</kbd> {t.cmdCloseHint}</span>
        </div>
      </div>
    </div>
  )
}
