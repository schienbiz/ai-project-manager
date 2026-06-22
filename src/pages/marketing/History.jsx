import { useState, useEffect } from 'react'
import { getHistory, deleteHistory, downloadAsPDF } from '../../marketing-api.js'

const TYPE_META = {
  content:  { icon: '✍️', color: '#6366f1', bg: '#ede9fe' },
  analytics: { icon: '📊', color: '#0891b2', bg: '#e0f2fe' },
  campaign: { icon: '📅', color: '#7c3aed', bg: '#f3e8ff' },
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function History() {
  const [records, setRecords] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getHistory().then(r => { setRecords(r); setLoading(false) })
  }, [])

  const handleDelete = async (id) => {
    await deleteHistory(id)
    setRecords(prev => prev.filter(r => r.id !== id))
    if (expanded === id) setExpanded(null)
  }

  const filtered = filter === 'all' ? records : records.filter(r => r.type === filter)
  const counts = {
    all: records.length,
    content: records.filter(r => r.type === 'content').length,
    analytics: records.filter(r => r.type === 'analytics').length,
    campaign: records.filter(r => r.type === 'campaign').length,
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <h1 className="mkt-section-title">Content History</h1>
        <p className="mkt-section-desc">All generated content — up to 50 most recent records</p>
      </div>

      <div className="flex gap-2 mb-6">
        {['all', 'content', 'analytics', 'campaign'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-all ${
              filter === f
                ? 'text-white border-transparent shadow-sm'
                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
            }`}
            style={filter === f ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' } : {}}
          >
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            <span className={`ml-1.5 ${filter === f ? 'text-indigo-200' : 'text-gray-400'}`}>{counts[f]}</span>
          </button>
        ))}
      </div>

      {loading && <div className="text-center py-20 text-gray-400 text-sm">Loading...</div>}

      {!loading && filtered.length === 0 && (
        <div className="mkt-card border-2 border-dashed border-gray-200 text-center py-16">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-gray-500 font-medium">No records yet</p>
          <p className="text-gray-400 text-sm mt-1">Generate content and it will appear here automatically.</p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map(record => {
          const meta = TYPE_META[record.type] || TYPE_META.content
          const isOpen = expanded === record.id
          return (
            <div key={record.id} className="mkt-card p-0 overflow-hidden transition-all">
              <div
                className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-gray-50/60 transition-colors"
                onClick={() => setExpanded(isOpen ? null : record.id)}
              >
                <span className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                  style={{ background: meta.bg }}>
                  {meta.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ color: meta.color, background: meta.bg }}>
                      {record.label}
                    </span>
                  </div>
                  {record.topic && <p className="text-xs text-gray-400 mt-0.5 truncate">{record.topic}</p>}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs text-gray-400">{timeAgo(record.createdAt)}</span>
                  <button
                    onClick={e => { e.stopPropagation(); downloadAsPDF(record.label, record.output, record.type) }}
                    className="text-xs px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-gray-500 hover:text-indigo-600 hover:border-indigo-300 transition-all"
                  >
                    PDF
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(record.id) }}
                    className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none"
                  >
                    ×
                  </button>
                  <span className={`text-gray-300 text-xs transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>▾</span>
                </div>
              </div>

              {isOpen && (
                <div className="border-t border-gray-100">
                  <div className="px-5 py-4 flex justify-between items-center bg-gray-50/50">
                    <span className="text-xs text-gray-400">
                      {new Date(record.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => navigator.clipboard.writeText(record.output)}
                        className="text-xs px-3 py-1 bg-white border border-gray-200 rounded-lg text-gray-500 hover:text-gray-700 transition-all"
                      >
                        Copy
                      </button>
                      <button
                        onClick={() => downloadAsPDF(record.label, record.output, record.type)}
                        className="text-xs px-3 py-1 rounded-lg text-white transition-all"
                        style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
                      >
                        Download PDF
                      </button>
                    </div>
                  </div>
                  <pre className="px-5 py-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto font-sans">
                    {record.output}
                  </pre>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
