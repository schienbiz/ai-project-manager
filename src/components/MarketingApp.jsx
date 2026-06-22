import { useState } from 'react'
import '../marketing.css'
import Dashboard from '../pages/marketing/Dashboard.jsx'
import ContentWriter from '../pages/marketing/ContentWriter.jsx'
import CampaignPlanner from '../pages/marketing/CampaignPlanner.jsx'
import AnalyticsSummary from '../pages/marketing/AnalyticsSummary.jsx'
import BrandVoice from '../pages/marketing/BrandVoice.jsx'
import History from '../pages/marketing/History.jsx'

const NAV = [
  { page: 'dashboard', icon: '⚡', label: 'Dashboard' },
  { page: 'content',   icon: '✍️', label: 'Content Writer' },
  { page: 'campaign',  icon: '📅', label: 'Campaign Planner' },
  { page: 'analytics', icon: '📊', label: 'Analytics Summary' },
  { page: 'brand',     icon: '🎨', label: 'Brand Voice' },
  { page: 'history',   icon: '🗂️', label: 'History' },
]

export default function MarketingApp({ onBack }) {
  const [page, setPage] = useState('dashboard')

  return (
    <div className="flex min-h-screen" style={{ background: '#f0f2f9' }}>
      {/* Sidebar */}
      <aside className="w-64 min-h-screen flex flex-col flex-shrink-0" style={{ background: '#0f0f23' }}>
        <div className="px-6 py-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)' }}>
              📣
            </div>
            <div>
              <div className="text-white font-bold text-sm leading-tight tracking-tight">Marketing AI</div>
              <div className="text-xs" style={{ color: '#6b7aaa' }}>Smriti Chain LLC</div>
            </div>
          </div>
        </div>

        <div className="mx-6 mb-4" style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />

        <nav className="flex-1 px-3 space-y-0.5">
          {NAV.map(({ page: p, icon, label }) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
              style={page === p
                ? { background: 'linear-gradient(135deg, rgba(99,102,241,0.35) 0%, rgba(139,92,246,0.35) 100%)', color: '#fff' }
                : { color: '#8892b0' }
              }
            >
              <span className="text-base w-5 text-center">{icon}</span>
              <span>{label}</span>
              {page === p && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />}
            </button>
          ))}
        </nav>

        <div className="px-4 py-4">
          <button
            onClick={onBack}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-colors"
            style={{ color: '#6b7aaa' }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = '#6b7aaa'}
          >
            ← Back to AI PM
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {page === 'dashboard' && <Dashboard onNavigate={setPage} />}
        {page === 'content'   && <ContentWriter />}
        {page === 'campaign'  && <CampaignPlanner />}
        {page === 'analytics' && <AnalyticsSummary />}
        {page === 'brand'     && <BrandVoice />}
        {page === 'history'   && <History />}
      </main>
    </div>
  )
}
