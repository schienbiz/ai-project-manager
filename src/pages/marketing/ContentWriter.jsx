import { useState, useEffect, useCallback, useRef } from 'react'
import { getBrand, streamRequest, saveHistory } from '../../marketing-api.js'
import StreamingOutput from '../../components/marketing/StreamingOutput.jsx'

const TYPES = [
  { value: 'social-post', label: '📱 Social Post' },
  { value: 'blog', label: '📝 Blog Article' },
  { value: 'ad-copy', label: '🎯 Ad Copy' },
  { value: 'email', label: '📧 Email' },
  { value: 'product-desc', label: '🛍️ Product Desc' },
  { value: 'press-release', label: '📰 Press Release' },
]

const PLATFORMS_SOCIAL = ['Instagram', 'LinkedIn', 'Twitter/X', 'Facebook', 'TikTok']
const PLATFORMS_AD = ['Meta Ads', 'Google Ads', 'LinkedIn Ads', 'TikTok Ads', 'Display']
const TONES = ['Professional', 'Friendly & Casual', 'Energetic & Bold', 'Empathetic', 'Witty & Humorous', 'Authoritative', 'Inspirational']

export default function ContentWriter() {
  const [type, setType] = useState('social-post')
  const [topic, setTopic] = useState('')
  const [platform, setPlatform] = useState('')
  const [tone, setTone] = useState('')
  const [length, setLength] = useState('medium')
  const [brand, setBrand] = useState({})
  const [useBrand, setUseBrand] = useState(true)
  const [output, setOutput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [copied, setCopied] = useState(false)
  const accumulated = useRef('')

  useEffect(() => { getBrand().then(setBrand) }, [])

  const generate = useCallback(async () => {
    if (!topic.trim()) return
    setOutput('')
    setIsStreaming(true)
    setCopied(false)
    accumulated.current = ''

    const typeLabel = TYPES.find(t => t.value === type)?.label.replace(/^\S+\s/, '') || type
    const label = platform ? `${typeLabel} · ${platform}` : typeLabel

    await streamRequest(
      '/generate',
      { type, topic, platform, tone, length, brand: useBrand ? brand : {} },
      (text) => { accumulated.current += text; setOutput(prev => prev + text) },
      () => {
        setIsStreaming(false)
        if (accumulated.current.trim()) {
          saveHistory({ type: 'content', label, topic, output: accumulated.current })
        }
      },
      (err) => { setOutput(`Error: ${err}`); setIsStreaming(false) }
    )
  }, [type, topic, platform, tone, length, brand, useBrand])

  const copy = () => {
    navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isSocial = type === 'social-post'
  const isAd = type === 'ad-copy'

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="mkt-section-title">Content Writer</h1>
      <p className="mkt-section-desc">Generate on-brand marketing copy for any channel</p>

      <div className="grid grid-cols-5 gap-6">
        <div className="col-span-2 space-y-4">
          <div className="mkt-card space-y-5">
            <div>
              <label className="mkt-label">Content Type</label>
              <div className="grid grid-cols-2 gap-1.5">
                {TYPES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => { setType(t.value); setPlatform('') }}
                    className={`text-left px-3 py-2 rounded-xl text-xs font-medium transition-all duration-150 border ${
                      type === t.value
                        ? 'text-white border-transparent shadow-sm'
                        : 'bg-gray-50 text-gray-600 border-gray-100 hover:bg-gray-100'
                    }`}
                    style={type === t.value ? { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' } : {}}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {(isSocial || isAd) && (
              <div>
                <label className="mkt-label">Platform</label>
                <select className="mkt-input" value={platform} onChange={e => setPlatform(e.target.value)}>
                  <option value="">Any / General</option>
                  {(isSocial ? PLATFORMS_SOCIAL : PLATFORMS_AD).map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="mkt-label">Tone Override</label>
              <select className="mkt-input" value={tone} onChange={e => setTone(e.target.value)}>
                <option value="">Use brand default</option>
                {TONES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div>
              <label className="mkt-label">Length</label>
              <div className="flex gap-1.5">
                {['short', 'medium', 'long'].map(l => (
                  <button
                    key={l}
                    onClick={() => setLength(l)}
                    className={length === l ? 'mkt-pill-btn-active' : 'mkt-pill-btn-inactive'}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {brand.name && (
              <label className="flex items-center gap-2.5 cursor-pointer group">
                <div
                  onClick={() => setUseBrand(!useBrand)}
                  className={`w-9 h-5 rounded-full relative transition-colors duration-200 cursor-pointer flex-shrink-0 ${
                    useBrand ? 'bg-indigo-500' : 'bg-gray-200'
                  }`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${
                    useBrand ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </div>
                <span className="text-xs font-medium text-gray-600">
                  Brand voice <span className="text-indigo-600">({brand.name})</span>
                </span>
              </label>
            )}
          </div>
        </div>

        <div className="col-span-3 space-y-4">
          <div className="mkt-card">
            <label className="mkt-label">Topic / Brief</label>
            <textarea
              className="mkt-input min-h-28 resize-none"
              placeholder="Describe what you want to write about..."
              value={topic}
              onChange={e => setTopic(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate() }}
            />
            <button
              onClick={generate}
              disabled={isStreaming || !topic.trim()}
              className="mkt-btn-primary w-full mt-3"
            >
              {isStreaming ? (
                <><span className="mkt-spinner" /> Generating...</>
              ) : (
                <>✨ Generate Content</>
              )}
            </button>
          </div>

          <StreamingOutput
            text={output}
            isStreaming={isStreaming}
            onCopy={copy}
            copied={copied}
            placeholder="Your generated content will appear here..."
            team={brand.team}
            pdfTitle={topic.trim() || 'Marketing Content'}
            pdfMeta={TYPES.find(t => t.value === type)?.label.replace(/^\S+\s/, '') || type}
          />
        </div>
      </div>
    </div>
  )
}
