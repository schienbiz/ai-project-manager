import { useState, useEffect, useCallback, useRef } from 'react'
import { getBrand, streamRequest, saveHistory } from '../../marketing-api.js'
import StreamingOutput from '../../components/marketing/StreamingOutput.jsx'

const EXAMPLE_DATA = `Campaign: Summer Sale Email
Period: June 1-30, 2024

Open Rate: 24.3% (industry avg: 21.5%)
Click Rate: 3.8% (industry avg: 2.6%)
Conversions: 142 (goal was 100)
Revenue: $28,400
Unsubscribes: 0.4%
Bounce Rate: 1.2%

Top performing subject: "Last chance: 40% off ends tonight" → 31% open rate
Worst performing: "June Newsletter" → 18% open rate

Audience: 12,500 subscribers
Segment A (VIP): 2,100 subs, 35% open rate, 6.2% CTR
Segment B (Regular): 10,400 subs, 21% open rate, 3.1% CTR`

export default function AnalyticsSummary() {
  const [data, setData] = useState('')
  const [context, setContext] = useState('')
  const [brand, setBrand] = useState({})
  const [useBrand, setUseBrand] = useState(true)
  const [output, setOutput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [copied, setCopied] = useState(false)
  const accumulated = useRef('')

  useEffect(() => { getBrand().then(setBrand) }, [])

  const analyze = useCallback(async () => {
    if (!data.trim()) return
    setOutput('')
    setIsStreaming(true)
    setCopied(false)
    accumulated.current = ''

    await streamRequest(
      '/analyze',
      { data, context, brand: useBrand ? brand : {} },
      (text) => { accumulated.current += text; setOutput(prev => prev + text) },
      () => {
        setIsStreaming(false)
        if (accumulated.current.trim()) {
          saveHistory({ type: 'analytics', label: context.trim() || 'Analytics Report', topic: context || undefined, output: accumulated.current })
        }
      },
      (err) => { setOutput(`Error: ${err}`); setIsStreaming(false) }
    )
  }, [data, context, brand, useBrand])

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="mkt-section-title">Analytics Summary</h1>
      <p className="mkt-section-desc">Paste any marketing data — AI turns it into actionable insights</p>

      <div className="grid grid-cols-5 gap-6">
        <div className="col-span-2 space-y-4">
          <div className="mkt-card space-y-4">
            <div>
              <label className="mkt-label">Context (optional)</label>
              <input
                className="mkt-input"
                placeholder="e.g. Q2 email campaign review"
                value={context}
                onChange={e => setContext(e.target.value)}
              />
            </div>

            <div>
              <label className="mkt-label">Raw Data *</label>
              <textarea
                className="mkt-input resize-none"
                style={{ minHeight: '280px' }}
                placeholder="Paste your data here — numbers, tables, CSV, or plain text metrics"
                value={data}
                onChange={e => setData(e.target.value)}
              />
            </div>

            <button
              onClick={() => setData(EXAMPLE_DATA)}
              className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
            >
              Load example data →
            </button>

            {brand.name && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={useBrand}
                  onChange={e => setUseBrand(e.target.checked)}
                  className="rounded text-indigo-600"
                />
                <span className="text-gray-700">Include brand context</span>
              </label>
            )}

            <button onClick={analyze} disabled={isStreaming || !data.trim()} className="mkt-btn-primary w-full">
              {isStreaming ? (
                <><span className="mkt-spinner" /> Analyzing...</>
              ) : '🔍 Analyze Data'}
            </button>
          </div>

          <div className="mkt-card bg-indigo-50 border-indigo-100">
            <p className="text-xs font-medium text-indigo-700 mb-2">Supported data types</p>
            <ul className="text-xs text-indigo-600 space-y-1">
              {['Email metrics (open rate, CTR, revenue)', 'Social media performance', 'Google Analytics / GA4 exports', 'Ad campaign metrics (ROAS, CPC, CTR)', 'CRM/sales pipeline data', 'Any copy-pasted numbers or tables'].map(item => (
                <li key={item} className="flex items-start gap-1.5"><span>•</span>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="col-span-3">
          <StreamingOutput
            text={output}
            isStreaming={isStreaming}
            onCopy={() => { navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            copied={copied}
            placeholder="Insights and recommendations will appear here..."
            team={brand.team}
            pdfTitle={context.trim() || 'Analytics Report'}
            pdfMeta="Analytics"
          />
        </div>
      </div>
    </div>
  )
}
