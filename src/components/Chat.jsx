import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import FlameOrb from './FlameOrb.jsx'
import { useSpeechInput } from '../useSpeechInput.js'
import { useSpeechOutput } from '../useSpeechOutput.js'

marked.setOptions({ breaks: true })

function renderMarkdown(text) {
  return { __html: DOMPurify.sanitize(marked.parse(text || '')) }
}

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' })

export default function Chat({ account, messages, status, error, onSend, onSignOut }) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const busy = status === 'thinking' || status === 'connecting'

  // Voice language: 'auto' | 'en-IN' | 'hi-IN'
  // AUTO uses the hi-IN recognizer, which handles mixed Hindi-English
  // (Hinglish) speech — the browser cannot listen in two languages at once.
  const LANG_MODES = ['auto', 'en-IN', 'hi-IN']
  const LANG_LABEL = { auto: 'AUTO', 'en-IN': 'EN', 'hi-IN': 'हिं' }
  const [voiceLang, setVoiceLang] = useState(() => {
    const saved = localStorage.getItem('gailexa-voice-lang')
    return LANG_MODES.includes(saved) ? saved : 'auto'
  })
  const isHindi = voiceLang === 'hi-IN'
  const effectiveLang = voiceLang === 'en-IN' ? 'en-IN' : 'hi-IN'

  function toggleLang() {
    const next = LANG_MODES[(LANG_MODES.indexOf(voiceLang) + 1) % LANG_MODES.length]
    setVoiceLang(next)
    localStorage.setItem('gailexa-voice-lang', next)
  }

  const transcriptRef = useRef('')
  const { supported: voiceSupported, listening, elapsed, toggle: toggleVoice } = useSpeechInput({
    lang: effectiveLang,
    maxSeconds: 30,
    onTranscript: (text) => {
      transcriptRef.current = text
      setDraft(text)
    },
    onEnd: () => {
      // Auto-send: whatever was heard goes straight to GAILexa
      const text = transcriptRef.current.trim()
      transcriptRef.current = ''
      if (text) {
        setDraft('')
        onSend(text)
      }
    },
  })

  const { supported: ttsSupported, speakingId, toggleSpeak } = useSpeechOutput()

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, status])

  function submit(text) {
    onSend(text ?? draft)
    setDraft('')
    inputRef.current?.focus()
  }

  const initials = (account?.name || account?.username || '?')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const statusLabel = {
    connecting: 'Connecting…',
    thinking: 'Thinking…',
    ready: 'Online',
    error: 'Connection error',
    idle: '',
  }[status]

  const lastBot = [...messages].reverse().find((m) => m.role === 'bot')

  return (
    <div className="chat">
      <header className="chat__header">
        <div className="chat__brand">
          <FlameOrb size={38} flicker={busy} />
          <div>
            <div className="chat__title">GAILexa</div>
            <div className={`chat__status chat__status--${status}`}>{statusLabel}</div>
          </div>
        </div>
        <div className="chat__user">
          <span className="chat__avatar" title={account?.username}>{initials}</span>
          <button className="btn btn--ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </header>
      <div className="flame-rule" aria-hidden="true" />

      <main className="chat__scroll" ref={scrollRef}>
        <div className="chat__column">
          {status === 'connecting' && messages.length === 0 && (
            <div className="chat__empty">
              <FlameOrb size={56} flicker />
              <p>Lighting the burner… connecting you to GAILexa.</p>
            </div>
          )}

          {messages.map((m) => (
            <MessageRow
              key={m.id}
              message={m}
              onQuickReply={submit}
              disabled={busy}
              isLastBot={m === lastBot}
              ttsSupported={ttsSupported}
              speaking={speakingId === m.id}
              onToggleSpeak={() => toggleSpeak(m.id, m.text)}
            />
          ))}

          {status === 'thinking' && (
            <div className="row row--bot">
              <FlameOrb size={32} flicker />
              <div className="bubble bubble--bot bubble--typing">
                <span className="dot" /><span className="dot" /><span className="dot" />
              </div>
            </div>
          )}

          {error && <div className="notice notice--error">{error}</div>}
        </div>
      </main>

      <footer className="chat__composer">
        <div className="chat__column">
          <form
            className="composer"
            onSubmit={(e) => { e.preventDefault(); submit() }}
          >
            <input
              ref={inputRef}
              className="composer__input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                listening
                  ? isHindi
                    ? `सुन रहा हूँ… रुकते ही भेज दूँगा (${30 - elapsed}s)`
                    : `Listening… sends automatically when you pause (${30 - elapsed}s)`
                  : busy
                    ? 'GAILexa is responding…'
                    : 'Ask GAILexa anything…'
              }
              disabled={status === 'connecting'}
              autoFocus
            />
            {voiceSupported && (
              <>
                <button
                  type="button"
                  className="composer__lang"
                  onClick={toggleLang}
                  disabled={listening}
                  aria-label={`Voice language: ${LANG_LABEL[voiceLang]}. Tap to change.`}
                  title={
                    voiceLang === 'auto'
                      ? 'Voice: Auto (Hindi + English) — tap for English only'
                      : voiceLang === 'en-IN'
                        ? 'Voice: English — tap for हिंदी'
                        : 'Voice: हिंदी — tap for Auto'
                  }
                >
                  {LANG_LABEL[voiceLang]}
                </button>
                <button
                  type="button"
                className={`composer__mic${listening ? ' composer__mic--on' : ''}`}
                onClick={toggleVoice}
                disabled={busy}
                aria-label={listening ? 'Stop and send' : 'Ask with your voice (auto-sends)'}
                title={listening ? 'Stop and send' : 'Ask with your voice (auto-sends)'}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0" />
                  <path d="M12 17v4" />
                </svg>
                </button>
              </>
            )}
            <button
              type="submit"
              className="composer__send"
              disabled={busy || !draft.trim()}
              aria-label="Send message"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" />
              </svg>
            </button>
          </form>
          <p className="composer__hint">
            GAILexa can make mistakes — verify important information. | Developed by BIS Department 2026
          </p>
        </div>
      </footer>
    </div>
  )
}

function MessageRow({ message, onQuickReply, disabled, isLastBot, ttsSupported, speaking, onToggleSpeak }) {
  if (message.role === 'user') {
    return (
      <div className="row row--user">
        <div className="bubble bubble--user">
          <p>{message.text}</p>
          <time className="bubble__time">{timeFmt.format(message.at)}</time>
        </div>
      </div>
    )
  }
  return (
    <div className="row row--bot">
      <FlameOrb size={32} />
      <div className="bubble bubble--bot">
        {message.text && (
          <div className="bubble__md" dangerouslySetInnerHTML={renderMarkdown(message.text)} />
        )}
        {isLastBot && message.actions?.length > 0 && (
          <div className="quick-replies">
            {message.actions.map((a) => (
              <button
                key={a}
                className="chip"
                disabled={disabled}
                onClick={() => onQuickReply(a)}
              >
                {a}
              </button>
            ))}
          </div>
        )}
        <div className="bubble__foot">
          {ttsSupported && message.text && (
            <button
              type="button"
              className={`voice-note${speaking ? ' voice-note--playing' : ''}`}
              onClick={onToggleSpeak}
              aria-label={speaking ? 'Stop voice note' : 'Play as voice note'}
              title={speaking ? 'Stop' : 'Listen to this answer'}
            >
              {speaking ? (
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                  <path d="M8 5.5v13l11-6.5z" />
                </svg>
              )}
              <span className="voice-note__bars" aria-hidden="true">
                <i /><i /><i /><i />
              </span>
            </button>
          )}
          <time className="bubble__time">{timeFmt.format(message.at)}</time>
        </div>
      </div>
    </div>
  )
}
