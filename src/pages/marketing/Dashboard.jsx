import { useEffect, useState } from 'react'
import { getCampaigns, getBrand, getHistory } from '../../marketing-api.js'

const quickActions = [
  { page: 'content', icon: '✍️', label: 'Write Content', desc: 'Social posts, blogs, ads & emails', color: '#6366f1' },
  { page: 'campaign', icon: '📅', label: 'Plan Campaign', desc: 'Full campaign strategy with AI', color: '#8b5cf6' },
  { page: 'analytics', icon: '📊', label: 'Analyze Data', desc: 'Turn metrics into insights', color: '#06b6d4' },
  { page: 'brand', icon: '🎨', label: 'Brand Voice', desc: 'Set tone & style for all content', color: '#f59e0b' },
]

export default function Dashboard({ onNavigate }) {
  const [campaigns, setCampaigns] = useState([])
  const [brand, setBrand] = useState({})
  const [historyCount, setHistoryCount] = useState(0)

  useEffect(() => {
    getCampaigns().then(setCampaigns)
    getBrand().then(setBrand)
    getHistory().then(h => setHistoryCount(h.length))
  }, [])

  const activeCampaigns = campaigns.filter(c => new Date(c.endDate) >= new Date())

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <p className="text-xs font-semibold text-indigo-500 uppercase tracking-widest mb-1">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
          {brand.name ? `${brand.name}'s Marketing Hub` : 'Marketing Hub'}
        </h1>
        <p className="text-gray-500 mt-1 text-sm">Your AI-powered marketing workspace</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="mkt-stat-card">
          <div className="mkt-stat-number" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {campaigns.length}
          </div>
          <div className="mkt-stat-label">Total Campaigns</div>
        </div>
        <div className="mkt-stat-card">
          <div className="mkt-stat-number text-emerald-500">{activeCampaigns.length}</div>
          <div className="mkt-stat-label">Active Now</div>
        </div>
        <div className="mkt-stat-card">
          <div className="mkt-stat-number" style={{ color: '#0891b2' }}>{historyCount}</div>
          <div className="mkt-stat-label">Content Generated</div>
        </div>
      </div>

      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Quick Actions</h2>
      <div className="grid grid-cols-2 gap-4 mb-8">
        {quickActions.map(({ page, icon, label, desc, color }) => (
          <button
            key={page}
            onClick={() => onNavigate(page)}
            className="mkt-card-hover group flex items-start gap-4 cursor-pointer text-left w-full"
          >
            <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0 transition-transform duration-150 group-hover:scale-110"
              style={{ background: `${color}18` }}>
              {icon}
            </div>
            <div>
              <div className="font-semibold text-gray-900 text-sm">{label}</div>
              <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
            </div>
            <div className="ml-auto text-gray-300 group-hover:text-indigo-400 transition-colors text-sm self-center">→</div>
          </button>
        ))}
      </div>

      {campaigns.length > 0 && (
        <>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Recent Campaigns</h2>
          <div className="mkt-card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead style={{ background: '#fafafa' }}>
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Campaign</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Goal</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Timeline</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {campaigns.slice(0, 5).map(c => {
                  const isActive = new Date(c.endDate) >= new Date()
                  return (
                    <tr key={c.id} className="hover:bg-indigo-50/40 transition-colors">
                      <td className="px-5 py-3.5 font-semibold text-gray-900 text-sm">{c.name}</td>
                      <td className="px-5 py-3.5 text-gray-400 text-sm truncate max-w-48">{c.goal}</td>
                      <td className="px-5 py-3.5 text-gray-400 text-xs tabular-nums">{c.startDate} → {c.endDate}</td>
                      <td className="px-5 py-3.5">
                        <span className={isActive ? 'mkt-badge-active' : 'mkt-badge-ended'}>
                          {isActive ? 'Active' : 'Ended'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {campaigns.length === 0 && !brand.name && (
        <div className="mkt-card border-2 border-dashed border-gray-200 text-center py-14">
          <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center text-3xl"
            style={{ background: 'linear-gradient(135deg, #6366f110, #8b5cf610)' }}>
            🚀
          </div>
          <p className="text-gray-700 font-semibold">Ready to supercharge your marketing?</p>
          <p className="text-gray-400 text-sm mt-1.5 mb-5">Start by setting up your brand voice, then create your first campaign.</p>
          <button onClick={() => onNavigate('brand')} className="mkt-btn-primary">Set Up Brand Voice →</button>
        </div>
      )}
    </div>
  )
}
