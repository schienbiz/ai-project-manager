import { useRef, useState } from 'react'
import { downloadAsPDF, sendEmail } from '../../marketing-api.js'

export default function StreamingOutput({ text, isStreaming, onCopy, copied, placeholder, team, pdfTitle, pdfMeta }) {
  const ref = useRef(null)
  const [showTeam, setShowTeam] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState('')

  const sendTo = async (email) => {
    if (!email) return
    setShowTeam(false)
    setSending(true)
    setSent('')
    const body = `${text}\n\n---\nGenerated with Marketing Assistant`
    try {
      const data = await sendEmail(email, 'Marketing content from Smriti Chain LLC', body)
      setSent(data.ok ? email : `error: ${data.error}`)
    } catch (err) {
      setSent(`error: ${err.message}`)
    }
    setSending(false)
  }

  if (!text && !isStreaming) {
    return (
      <div className="min-h-52 flex flex-col items-center justify-center text-gray-300 text-sm
        border-2 border-dashed border-gray-200 rounded-2xl gap-2 bg-white/50">
        <span className="text-2xl opacity-60">✨</span>
        <span>{placeholder || 'Output will appear here'}</span>
      </div>
    )
  }

  return (
    <div className="relative">
      <div
        ref={ref}
        className={`mkt-streaming-output bg-white border rounded-2xl p-6 text-sm text-gray-700 min-h-52 max-h-[600px] overflow-y-auto shadow-sm transition-all ${
          isStreaming
            ? 'border-indigo-300 mkt-cursor-blink shadow-indigo-100'
            : 'border-gray-100'
        }`}
      >
        {text}
      </div>

      {isStreaming && (
        <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-indigo-600"
          style={{ background: 'rgba(99,102,241,0.08)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
          Generating
        </div>
      )}

      {text && !isStreaming && (
        <div className="absolute top-3 right-3 flex gap-2">
          {pdfTitle && (
            <button
              onClick={() => downloadAsPDF(pdfTitle, text, pdfMeta)}
              className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-all shadow-sm"
            >
              PDF
            </button>
          )}
          {onCopy && (
            <button
              onClick={onCopy}
              className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-all shadow-sm"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          )}

          <div className="relative">
            <button
              onClick={() => team && team.length > 0 ? setShowTeam(v => !v) : undefined}
              disabled={sending}
              className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-all shadow-sm flex items-center gap-1 disabled:opacity-50"
            >
              {sending ? 'Sending...' : sent && !sent.startsWith('error') ? '✓ Sent' : 'Send'}
              {!sending && team && team.length > 0 && <span className="opacity-50">▾</span>}
            </button>

            {showTeam && team && team.length > 0 && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowTeam(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-100 rounded-xl shadow-lg py-1 min-w-48">
                  {team.map(email => (
                    <button
                      key={email}
                      onClick={() => sendTo(email)}
                      className="w-full text-left px-4 py-2.5 text-xs text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                    >
                      {email}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
