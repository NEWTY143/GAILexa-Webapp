import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import FlameOrb from './FlameOrb.jsx'

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
            <MessageRow key={m.id} message={m} onQuickReply={submit} disabled={busy} isLastBot={m === lastBot} />
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
              placeholder={busy ? 'GAILexa is responding…' : 'Ask GAILexa anything…'}
              disabled={status === 'connecting'}
              autoFocus
            />
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
            GAILexa can make mistakes — verify important information.
          </p>
        </div>
      </footer>
    </div>
  )
}

function MessageRow({ message, onQuickReply, disabled, isLastBot }) {
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
        <time className="bubble__time">{timeFmt.format(message.at)}</time>
      </div>
    </div>
  )
}
