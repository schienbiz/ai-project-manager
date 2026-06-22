import { useState, useEffect } from 'react'
import { getBrand, saveBrand } from '../../marketing-api.js'

const TONES = ['Professional', 'Friendly & Approachable', 'Bold & Energetic', 'Luxurious & Exclusive', 'Playful & Witty', 'Empathetic & Caring', 'Authoritative & Expert', 'Inspirational & Motivating']

export default function BrandVoice() {
  const [brand, setBrand] = useState({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [newEmail, setNewEmail] = useState('')

  useEffect(() => { getBrand().then(setBrand) }, [])

  const update = (key, val) => {
    setBrand(prev => ({ ...prev, [key]: val }))
    setSaved(false)
  }

  const addTeamEmail = () => {
    const email = newEmail.trim().toLowerCase()
    if (!email || !email.includes('@')) return
    const existing = brand.team || []
    if (existing.includes(email)) { setNewEmail(''); return }
    setBrand(prev => ({ ...prev, team: [...existing, email] }))
    setNewEmail('')
    setSaved(false)
  }

  const removeTeamEmail = (email) => {
    setBrand(prev => ({ ...prev, team: (prev.team || []).filter(e => e !== email) }))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    await saveBrand(brand)
    setSaving(false)
    setSaved(true)
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="mkt-section-title">Brand Voice Manager</h1>
      <p className="mkt-section-desc">
        Configure your brand identity once — it's automatically applied to all generated content
      </p>

      <div className="mkt-card space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mkt-label">Brand / Company Name</label>
            <input className="mkt-input" placeholder="e.g. Acme Corp" value={brand.name || ''} onChange={e => update('name', e.target.value)} />
          </div>
          <div>
            <label className="mkt-label">Industry / Category</label>
            <input className="mkt-input" placeholder="e.g. SaaS, E-commerce, F&B" value={brand.industry || ''} onChange={e => update('industry', e.target.value)} />
          </div>
        </div>

        <div>
          <label className="mkt-label">Tone of Voice</label>
          <select className="mkt-input" value={brand.tone || ''} onChange={e => update('tone', e.target.value)}>
            <option value="">Select a tone...</option>
            {TONES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label className="mkt-label">Target Audience</label>
          <input
            className="mkt-input"
            placeholder="e.g. Female entrepreneurs aged 28-45"
            value={brand.audience || ''}
            onChange={e => update('audience', e.target.value)}
          />
        </div>

        <div>
          <label className="mkt-label">Brand Values</label>
          <input
            className="mkt-input"
            placeholder="e.g. Innovation, Transparency, Customer-first"
            value={brand.values || ''}
            onChange={e => update('values', e.target.value)}
          />
        </div>

        <div>
          <label className="mkt-label">Key Messages & Keywords</label>
          <textarea
            className="mkt-input min-h-16 resize-none"
            placeholder="e.g. 'effortless growth', 'built for teams'"
            value={brand.keywords || ''}
            onChange={e => update('keywords', e.target.value)}
          />
        </div>

        <div>
          <label className="mkt-label">Example Copy / Writing Style</label>
          <textarea
            className="mkt-input min-h-24 resize-none"
            placeholder="Paste 1-2 paragraphs of your best existing copy. AI will match this style."
            value={brand.exampleCopy || ''}
            onChange={e => update('exampleCopy', e.target.value)}
          />
        </div>

        <div className="pt-4 border-t border-gray-100">
          <label className="mkt-label mb-3">Team Members</label>
          <p className="text-xs text-gray-400 mb-3">These emails appear in the Send button when sharing generated content.</p>
          <div className="space-y-2 mb-3">
            {(brand.team || []).map(email => (
              <div key={email} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-xl text-sm">
                <span className="text-gray-700">{email}</span>
                <button onClick={() => removeTeamEmail(email)} className="text-gray-300 hover:text-red-400 transition-colors text-xs px-1">✕</button>
              </div>
            ))}
            {(brand.team || []).length === 0 && (
              <p className="text-xs text-gray-300 italic">No team members yet</p>
            )}
          </div>
          <div className="flex gap-2">
            <input
              className="mkt-input flex-1"
              placeholder="teammate@example.com"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTeamEmail()}
            />
            <button onClick={addTeamEmail} className="mkt-btn-secondary px-4">Add</button>
          </div>
        </div>

        <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
          {saved ? (
            <span className="text-sm text-emerald-600 font-medium">✓ Brand voice saved</span>
          ) : (
            <span className="text-sm text-gray-400">Unsaved changes</span>
          )}
          <button onClick={handleSave} disabled={saving} className="mkt-btn-primary">
            {saving ? 'Saving...' : '💾 Save Brand Voice'}
          </button>
        </div>
      </div>

      {brand.name && (
        <div className="mkt-card mt-4 bg-indigo-50 border-indigo-100">
          <p className="text-sm font-medium text-indigo-800 mb-2">Brand Preview</p>
          <div className="text-sm text-indigo-700 space-y-1">
            {brand.name && <p><span className="font-medium">Brand:</span> {brand.name} {brand.industry && `(${brand.industry})`}</p>}
            {brand.tone && <p><span className="font-medium">Tone:</span> {brand.tone}</p>}
            {brand.audience && <p><span className="font-medium">Audience:</span> {brand.audience}</p>}
            {brand.values && <p><span className="font-medium">Values:</span> {brand.values}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
