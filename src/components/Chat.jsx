import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import FlameOrb from './FlameOrb.jsx'
import { useSpeechInput } from '../useSpeechInput.js'
import { useWhisperInput } from '../useWhisperInput.js'
import { useSpeechOutput } from '../useSpeechOutput.js'
import { useAzureVoiceInput } from '../useAzureVoiceInput.js'
import { LANGUAGE_NAMES } from '../azureSpeech.js'
import TalkMode from './TalkMode.jsx'
import { appConfig, APP_VERSION } from '../config.js'

marked.setOptions({ breaks: true })

// Every link in a bot message opens in a new tab
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/**
 * DOCUMENT LINK MAP — citations from Copilot Studio "file group" sources
 * carry only an internal token (cite:1), not a real URL. So we bundle the
 * source PDFs with the web app (public/docs/) and match them by the
 * document title in the citation definition, e.g.
 *   [1]: cite:1 "GAIL Annual Report 2024-25"
 * Add/rename entries here if the knowledge base changes.
 */
const DOC_LINKS = [
  { match: /annual\s*report/i, href: '/docs/gail-annual-report-2024-25.pdf', label: 'GAIL Annual Report 2024-25' },
  { match: /faq|analyst\s*meet/i, href: '/docs/faq-2025-analyst-meet.pdf', label: 'FAQ 2025 – Analyst Meet' },
  { match: /vision\s*2040/i, href: '/docs/vision-2040.pdf', label: 'Vision 2040 – Natural Gas Infrastructure in India' },
  { match: /delegation|(^|[\W_])dop([\W_]|$)/i, href: '/docs/delegation-of-powers.pdf', label: 'Delegation of Powers (updated 21.11.2025)' },
  { match: /hlec/i, href: '/docs/hlec.pdf', label: 'HLEC – High Level Expert Committee' },
  { match: /(^|[\W_])csr([\W_]|$)/i, href: '/docs/csr.pdf', label: 'CSR' },
]

/**
 * Show citations in parentheses — and make them CLICKABLE when we know
 * the source: "…limits [1]." → "…limits (1)." where 1 opens the PDF.
 * Handles the marker styles Copilot Studio emits:
 *   [1]  [^1^]  and superscript digits ¹ ² ³
 * Resolution order per citation number:
 *   real http(s) URL in the definition → link to it
 *   title matches DOC_LINKS           → link to the bundled PDF
 *   otherwise                         → plain (n)
 */
const SUPERSCRIPTS = { '\u2070': '0', '\u00B9': '1', '\u00B2': '2', '\u00B3': '3', '\u2074': '4', '\u2075': '5', '\u2076': '6', '\u2077': '7', '\u2078': '8', '\u2079': '9' }

function parseCitationDefs(text) {
  // Matches: [1]: cite:1 "Title"   |   [2]: https://… "Title"   |   [3]: https://…
  const defs = {}
  const re = /^\s*\[(\d+)\]:\s*(\S+)(?:\s+"([^"]*)")?\s*$/gm
  let m
  while ((m = re.exec(text))) {
    const [, id, target, title] = m
    const url = /^https?:\/\//i.test(target) ? target : null
    defs[id] = { url, title: title || '' }
  }
  return defs
}

function citationAnchor(n, defs) {
  const def = defs[n]
  let href = def?.url || null
  let label = def?.title || ''
  if (!href && label) {
    const doc = DOC_LINKS.find((d) => d.match.test(label))
    if (doc) { href = doc.href; label = doc.label }
  }
  if (!href) {
    if (def) console.debug('[GAILexa] unresolved citation', n, def)
    return `(${n})`
  }
  const safeTitle = label.replace(/"/g, '&quot;')
  return `(<a class="cite-link" href="${href}" title="${safeTitle}">${n}</a>)`
}

function formatCitations(text = '', citations = {}) {
  // Merge: definitions found in the text + metadata from the activity's
  // entities (file-group PDFs usually ONLY have the latter).
  const defs = { ...parseCitationDefs(text) }
  for (const [n, c] of Object.entries(citations || {})) {
    // Entity metadata carries the REAL document name; the text definition
    // often only has a placeholder like "Citation-1" — so entities win.
    defs[n] = {
      url: c.url || defs[n]?.url || null,
      title: c.title || defs[n]?.title || '',
    }
  }
  return (
    text
      // definition lines are consumed here — remove them from the display
      .replace(/^\s*\[\d+\]:\s*\S+(?:\s+"[^"]*")?\s*$/gm, '')
      // [^1^] → (1) or (1‑as‑link)
      .replace(/\[\^(\d+)\^\]/g, (_, n) => citationAnchor(n, defs))
      // [1] not a real link "[1](url)" and not a definition "[1]: …"
      .replace(/(?<!\()\[(\d+)\](?!\(|:)/g, (_, n) => citationAnchor(n, defs))
      // runs of superscript digits → (n)
      .replace(/[\u2070\u00B9\u00B2\u00B3\u2074-\u2079]+/g, (run) => {
        const n = [...run].map((c) => SUPERSCRIPTS[c] ?? '').join('')
        return citationAnchor(n, defs)
      })
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

function renderMarkdown(text, citations) {
  return { __html: DOMPurify.sanitize(marked.parse(formatCitations(text || '', citations))) }
}

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' })

export default function Chat({ account, messages, status, error, onSend, onSignOut, getSpeechText, voiceLocale, onVoiceLocaleChange, onAskForTalk }) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const busy = status === 'thinking' || status === 'connecting'

  // Whisper mode: on when the transcription service URL is configured.
  // Whisper detects Hindi/English automatically, so no language toggle.
  const whisperOn = Boolean(appConfig.whisperUrl)
  const azureOn = Boolean(appConfig.azureSpeechEnabled || appConfig.azureSpeechKey)

  // Auto-send timer, shared by every voice path
  const pendingSendRef = useRef(null)
  useEffect(() => () => clearTimeout(pendingSendRef.current), [])

  // Language picker: 'auto' lets Azure detect; a specific locale forces it
  // (more accurate when the person knows which language they'll speak).
  const [langMode, setLangMode] = useState('auto')
  const [talkOpen, setTalkOpen] = useState(false)
  const cancelledSpeakRef = useRef(false)

  // --- Azure voice input (8 languages, translated to English for Copilot) --
  const azureVoice = useAzureVoiceInput({
    forcedLocale: langMode === 'auto' ? null : langMode,
    maxSeconds: 20,
    onResult: ({ original, english, locale }) => {
      onVoiceLocaleChange?.(locale)
      setDraft(english)
      clearTimeout(pendingSendRef.current)
      pendingSendRef.current = setTimeout(() => {
        setDraft('')
        onSend(english, { original, locale })
      }, 1600)
    },
    onError: () => setDraft(''),
  })

  // --- Web Speech fallback (used when no Whisper URL is configured) -------
  const transcriptRef = useRef('')
  const webSpeech = useSpeechInput({
    lang: 'en-IN',
    maxSeconds: 10,
    onTranscript: (text) => {
      if (whisperOn) return
      transcriptRef.current = text
      setDraft(text)
    },
    onEnd: () => {
      if (whisperOn) return
      // Auto-send: whatever was heard goes straight to GAILexa
      const text = transcriptRef.current.trim()
      transcriptRef.current = ''
      if (text) {
        setDraft('')
        onSend(text)
      }
    },
  })

  // --- Whisper input (records audio, server transcribes + detects lang) ---
  // The clean transcript is shown in the input bar for a moment so the
  // person can see (and interrupt) it before it auto-sends.
  const whisper = useWhisperInput({
    endpoint: appConfig.whisperUrl,
    maxSeconds: 10,
    onResult: (text) => {
      if (!text) return
      setDraft(text) // preview the corrected transcript in the text bar
      clearTimeout(pendingSendRef.current)
      pendingSendRef.current = setTimeout(() => {
        setDraft('')
        onSend(text) // auto-send; Copilot replies in the same language
      }, 1600)
    },
  })

  // Unified voice state used by the UI — Azure takes priority when enabled
  const voiceSupported = azureOn ? azureVoice.supported : whisperOn ? whisper.supported : webSpeech.supported
  const listening = azureOn ? azureVoice.listening : whisperOn ? whisper.phase === 'recording' : webSpeech.listening
  const transcribing = azureOn ? azureVoice.processing : whisperOn && whisper.phase === 'transcribing'
  const elapsed = azureOn ? azureVoice.elapsed : whisperOn ? whisper.elapsed : webSpeech.elapsed
  const toggleVoice = azureOn ? azureVoice.toggle : whisperOn ? whisper.toggle : webSpeech.toggle

  const { supported: ttsSupported, speakingId, toggleSpeak } = useSpeechOutput({
    endpoint: appConfig.whisperUrl, // same backend hosts the neural female /tts voice
  })

  // Voice-note click: long answers are summarized by GAILexa before playback
  const [preparingId, setPreparingId] = useState(null)
  async function handleSpeak(message) {
    if (speakingId === message.id) {
      toggleSpeak(message.id, message.text, voiceLocale) // same id → stop
      return
    }
    // Tapping again while a summary is being prepared cancels it, so the
    // person is never stuck waiting for audio they no longer want.
    if (preparingId) {
      cancelledSpeakRef.current = true
      setPreparingId(null)
      return
    }
    cancelledSpeakRef.current = false
    try {
      setPreparingId(message.id)
      const text = getSpeechText ? await getSpeechText(message) : message.text
      if (cancelledSpeakRef.current) return
      // GAILexa answers in English; it is translated into the language the
      // person used before being read aloud.
      toggleSpeak(message.id, text, voiceLocale)
    } finally {
      setPreparingId(null)
    }
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, status])

  function submit(text) {
    clearTimeout(pendingSendRef.current)
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
          <img
            className="chat__gail-logo"
            src="/gail-logo.png"
            alt="GAIL (India) Limited"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
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
              preparing={preparingId === m.id}
              onToggleSpeak={() => handleSpeak(m)}
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
          {azureOn && voiceSupported && (
            <div className="lang-bar" role="group" aria-label="Voice language">
              <span className="lang-bar__label">Voice</span>
              <button
                type="button"
                className={`lang-chip${langMode === 'auto' ? ' lang-chip--on' : ''}`}
                onClick={() => setLangMode('auto')}
                title="Detect the language automatically"
              >
                Auto
              </button>
              {Object.entries(LANGUAGE_NAMES).map(([locale, name]) => (
                <button
                  key={locale}
                  type="button"
                  className={`lang-chip${langMode === locale ? ' lang-chip--on' : ''}`}
                  onClick={() => setLangMode(locale)}
                  title={`Speak in ${name}`}
                >
                  {name}
                </button>
              ))}
              {voiceLocale && voiceLocale !== 'en-IN' && (
                <span className="lang-bar__active" title="Answers are read aloud in this language">
                  ▶ {LANGUAGE_NAMES[voiceLocale] || voiceLocale}
                </span>
              )}
            </div>
          )}
          <form
            className="composer"
            onSubmit={(e) => { e.preventDefault(); submit() }}
          >
            <input
              ref={inputRef}
              className="composer__input"
              value={draft}
              onChange={(e) => {
                clearTimeout(pendingSendRef.current) // editing cancels auto-send
                setDraft(e.target.value)
              }}
              placeholder={
                transcribing
                  ? azureOn ? 'Translating your words…' : 'Understanding your voice…'
                  : listening
                    ? azureOn
                      ? `Listening… speak naturally, pause when done (${elapsed}s)`
                      : whisperOn
                        ? `Listening… sends when you stop (${10 - elapsed}s)`
                        : `Listening… sends automatically when you pause (${10 - elapsed}s)`
                    : busy
                      ? 'GAILexa is responding…'
                      : azureOn
                        ? 'Ask GAILexa anything — type, or speak in your language'
                        : 'Ask GAILexa anything…'
              }
              disabled={status === 'connecting'}
              autoFocus
            />
            {voiceSupported && (
              <>
                <button
                  type="button"
                className={`composer__mic${listening ? ' composer__mic--on' : ''}${transcribing ? ' composer__mic--busy' : ''}`}
                onClick={toggleVoice}
                disabled={busy || transcribing}
                aria-label={
                  transcribing
                    ? 'Understanding your voice…'
                    : listening
                      ? 'Stop and send'
                      : 'Ask with your voice (auto-detects Hindi/English, auto-sends)'
                }
                title={
                  transcribing
                    ? 'Understanding your voice…'
                    : listening
                      ? 'Stop and send'
                      : 'Ask with your voice (auto-sends)'
                }
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0" />
                  <path d="M12 17v4" />
                </svg>
                </button>
              </>
            )}
            {azureOn && voiceSupported && (
              <button
                type="button"
                className="composer__talk"
                onClick={() => setTalkOpen(true)}
                aria-label="Talk to GAILexa"
                title="Talk to GAILexa — hands-free voice conversation"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
                  <path d="M4 10v4" />
                  <path d="M8.5 6.5v11" />
                  <path d="M13 4v16" />
                  <path d="M17.5 7.5v9" />
                  <path d="M22 10.5v3" />
                </svg>
              </button>
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
            Developed by BIS Department 2026 | v{APP_VERSION}
          </p>
        </div>
      </footer>

      {talkOpen && (
        <TalkMode
          locale={langMode}
          onAsk={onAskForTalk}
          onClose={() => setTalkOpen(false)}
        />
      )}
    </div>
  )
}

function MessageRow({ message, onQuickReply, disabled, isLastBot, ttsSupported, speaking, preparing, onToggleSpeak }) {
  if (message.role === 'user') {
    return (
      <div className="row row--user">
        <div className="bubble bubble--user">
          <p>{message.text}</p>
          {message.originalText && (
            <p className="bubble__original" title="What you said, before translation">
              {message.originalText}
            </p>
          )}
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
          <div className="bubble__md" dangerouslySetInnerHTML={renderMarkdown(message.text, message.citations)} />
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
              className={`voice-note${speaking ? ' voice-note--playing' : ''}${preparing ? ' voice-note--loading' : ''}`}
              onClick={onToggleSpeak}
              aria-label={preparing ? 'Stop — preparing summary' : speaking ? 'Stop voice note' : 'Play as voice note'}
              title={preparing ? 'Preparing a short summary — tap to cancel' : speaking ? 'Stop' : 'Listen (long answers are summarized)'}
            >
              {(speaking || preparing) ? (
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
