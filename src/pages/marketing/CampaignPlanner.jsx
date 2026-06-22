import { useState, useEffect, useCallback, useRef } from 'react'
import { getBrand, getCampaigns, saveCampaign, deleteCampaign, streamRequest, saveHistory } from '../../marketing-api.js'
import StreamingOutput from '../../components/marketing/StreamingOutput.jsx'

const CHANNELS = ['Instagram', 'LinkedIn', 'Twitter/X', 'Facebook', 'Email', 'Blog/SEO', 'Google Ads', 'Meta Ads', 'TikTok', 'YouTube', 'PR/Media', 'Events']

export default function CampaignPlanner() {
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [audience, setAudience] = useState('')
  const [budget, setBudget] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [channels, setChannels] = useState([])
  const [brand, setBrand] = useState({})
  const [campaigns, setCampaigns] = useState([])
  const [output, setOutput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedCampaign, setSavedCampaign] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null) // 極致審視: replace confirm()
  const accumulated = useRef('')

  useEffect(() => {
    getBrand().then(setBrand)
    getCampaigns().then(setCampaigns)
  }, [])

  const toggleChannel = (ch) => {
    setChannels(prev => prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch])
  }

  const generate = useCallback(async () => {
    if (!name || !goal || !startDate || !endDate) return
    setOutput('')
    setIsStreaming(true)
    setCopied(false)
    setSavedCampaign(false)
    accumulated.current = ''

    await streamRequest(
      '/plan-campaign',
      { name, goal, audience, budget, startDate, endDate, channels, brand },
      (text) => { accumulated.current += text; setOutput(prev => prev + text) },
      () => {
        setIsStreaming(false)
        if (accumulated.current.trim()) {
          saveHistory({ type: 'campaign', label: name, topic: goal, output: accumulated.current })
        }
      },
      (err) => { setOutput(`Error: ${err}`); setIsStreaming(false) }
    )
  }, [name, goal, audience, budget, startDate, endDate, channels, brand])

  const handleSave = async () => {
    if (!name || !goal || !startDate || !endDate) return
    setSaving(true)
    try {
      const saved = await saveCampaign({ name, goal, audience, budget, startDate, endDate, channels, plan: output })
      setCampaigns(prev => [saved, ...prev])
      setSavedCampaign(true)
    } catch (err) {
      setOutput(prev => prev + `\n\n⚠️ Save failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (id) => setPendingDelete(id)

  const confirmDelete = async () => {
    await deleteCampaign(pendingDelete)
    setCampaigns(prev => prev.filter(c => c.id !== pendingDelete))
    setPendingDelete(null)
  }

  const isValid = name && goal && startDate && endDate

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="mkt-section-title">Campaign Planner</h1>
      <p className="mkt-section-desc">Build AI-generated campaign strategies with content calendars and KPIs</p>

      {/* Inline delete confirm modal */}
      {pendingDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="bg-white rounded-2xl p-6 shadow-xl max-w-xs w-full mx-4">
            <p className="text-sm font-medium text-gray-700 mb-4">Delete this campaign?</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPendingDelete(null)} className="mkt-btn-secondary px-4 py-2 text-xs">Cancel</button>
              <button onClick={confirmDelete} className="text-xs px-4 py-2 rounded-xl bg-red-500 text-white font-semibold hover:bg-red-600">Delete</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-5 gap-6">
        <div className="col-span-2 space-y-4">
          <div className="mkt-card space-y-4">
            <div>
              <label className="mkt-label">Campaign Name *</label>
              <input className="mkt-input" placeholder="e.g. Summer Product Launch" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div>
              <label className="mkt-label">Objective / Goal *</label>
              <textarea className="mkt-input min-h-16 resize-none" placeholder="e.g. Generate 500 leads for new SaaS product" value={goal} onChange={e => setGoal(e.target.value)} />
            </div>
            <div>
              <label className="mkt-label">Target Audience</label>
              <input className="mkt-input" placeholder="e.g. SMB owners, age 30-50" value={audience} onChange={e => setAudience(e.target.value)} />
            </div>
            <div>
              <label className="mkt-label">Budget (optional)</label>
              <input className="mkt-input" placeholder="e.g. $5,000 / month" value={budget} onChange={e => setBudget(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mkt-label">Start Date *</label>
                <input type="date" className="mkt-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div>
                <label className="mkt-label">End Date *</label>
                <input type="date" className="mkt-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="mkt-label">Channels</label>
              <div className="flex flex-wrap gap-1.5">
                {CHANNELS.map(ch => (
                  <button
                    key={ch}
                    onClick={() => toggleChannel(ch)}
                    className={`px-2.5 py-1 text-xs rounded-full border font-medium transition-colors ${
                      channels.includes(ch)
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={generate} disabled={isStreaming || !isValid} className="mkt-btn-primary w-full">
              {isStreaming ? (
                <><span className="mkt-spinner" /> Planning...</>
              ) : '🗺️ Generate Campaign Plan'}
            </button>
          </div>
        </div>

        <div className="col-span-3 space-y-4">
          <StreamingOutput
            text={output}
            isStreaming={isStreaming}
            onCopy={() => { navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            copied={copied}
            placeholder="Your campaign plan will appear here..."
            pdfTitle={name || 'Campaign Plan'}
            pdfMeta="Campaign"
          />
          {output && !isStreaming && (
            <button onClick={handleSave} disabled={saving || savedCampaign} className="mkt-btn-secondary w-full">
              {savedCampaign ? '✓ Saved' : saving ? 'Saving...' : '💾 Save Campaign'}
            </button>
          )}
        </div>
      </div>

      {campaigns.length > 0 && (
        <div className="mt-8">
          <h2 className="text-base font-semibold text-gray-700 mb-3">Saved Campaigns</h2>
          <div className="space-y-3">
            {campaigns.map(c => (
              <div key={c.id} className="mkt-card p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900">{c.name}</div>
                  <div className="text-sm text-gray-500 mt-0.5 truncate">{c.goal}</div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                    <span>📅 {c.startDate} → {c.endDate}</span>
                    {c.channels?.length > 0 && <span>📡 {c.channels.slice(0, 3).join(', ')}{c.channels.length > 3 ? ` +${c.channels.length - 3}` : ''}</span>}
                  </div>
                </div>
                <button onClick={() => handleDelete(c.id)} className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none shrink-0">×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
