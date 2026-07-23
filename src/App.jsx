import { useEffect, useRef, useState } from 'react'
import { getAccount, signIn, signOut } from './auth.js'
import { GailexaSession } from './copilot.js'
import { validateConfig } from './config.js'
import SignIn from './components/SignIn.jsx'
import Chat from './components/Chat.jsx'

let messageCounter = 0
const nextId = () => `m-${++messageCounter}`

/**
 * Copilot Studio sends citation details (document name, sometimes a URL)
 * in the activity's `entities` as schema.org Claim objects — NOT in the
 * message text. Extract them into { "1": { title, url }, ... } so the
 * chat can turn (1) into a clickable link to the source document.
 */
function extractCitations(activity) {
  const out = {}
  try {
    for (const ent of activity?.entities || []) {
      const claims = ent?.citation || []
      for (const c of claims) {
        const pos = c?.position ?? c?.number
        if (pos == null) continue
        const ap = c?.appearance || {}
        out[String(pos)] = {
          title: ap.name || ap.text || c.name || '',
          url: ap.url || c.url || null,
        }
      }
    }
  } catch (e) {
    console.debug('[GAILexa] citation extraction failed:', e)
  }
  if (Object.keys(out).length) console.debug('[GAILexa] citations:', out)
  return out
}

export default function App() {
  const [account, setAccount] = useState(null)
  const [booting, setBooting] = useState(true)
  const [messages, setMessages] = useState([])
  const [status, setStatus] = useState('idle') // idle | connecting | ready | thinking | error
  const [error, setError] = useState(null)
  // The language the person is speaking in. Set by voice input, remembered
  // for the session, and used to translate answers back for playback.
  const [voiceLocale, setVoiceLocale] = useState('en-IN')
  const sessionRef = useRef(null)
  const summaryCacheRef = useRef({})
  const summaryJobsRef = useRef({}) // in-flight prefetch promises by message id
  const lastBotRef = useRef(null)
  const missingConfig = validateConfig()

  /**
   * Prepare the spoken version of a bot message in the BACKGROUND, as soon
   * as the answer arrives — so tapping play is instant. Short answers are
   * cached as-is; long ones are summarized by GAILexa via a hidden request.
   */
  function prefetchSummary(message) {
    const id = message.id
    if (summaryCacheRef.current[id]) return null
    if (summaryJobsRef.current[id]) return summaryJobsRef.current[id]

    const original = message.text || ''
    const isHindi = /[\u0900-\u097F]/.test(original)
    if (original.length < 300) {
      summaryCacheRef.current[id] = original
      return null
    }

    const prompt = isHindi
      ? 'पिछले उत्तर का सारांश ठीक 1-2 छोटे वाक्यों में दीजिए। पूरा उत्तर न दोहराएँ। केवल सारांश लिखें — कोई सूची, लिंक या संदर्भ नहीं।'
      : 'Summarize your previous answer in exactly 1-2 short sentences. Do NOT repeat the full answer. Reply with ONLY the summary — no lists, links, or citations.'

    const job = (async () => {
      try {
        const summary = await sessionRef.current.askHidden(prompt)
        // A valid summary is non-empty, meaningfully shorter than the
        // original, and NOT a refusal like "Sorry, can you rephrase?".
        // Otherwise, fall back to reading the full text directly.
        const looksLikeRefusal =
          /sorry|rephrase|try again|didn'?t (understand|get|catch)|couldn'?t (find|help)|unable to|no information|माफ|क्षमा|समझ नहीं|दोबारा/i.test(
            summary || ''
          )
        const valid =
          summary &&
          !looksLikeRefusal &&
          summary.length <= 450 &&
          summary.length <= original.length * 0.7
        summaryCacheRef.current[id] = valid ? summary : original
      } catch (e) {
        console.error('Summary prefetch failed — will read the full text:', e)
        summaryCacheRef.current[id] = original
      } finally {
        delete summaryJobsRef.current[id]
      }
    })()
    summaryJobsRef.current[id] = job
    return job
  }

  /** Wait for any hidden summary request to finish before a new user turn,
   *  so two messages never stream through the conversation at once. */
  async function drainSummaryJobs() {
    const jobs = Object.values(summaryJobsRef.current)
    if (jobs.length) await Promise.allSettled(jobs)
  }

  /**
   * Text for voice playback. Usually already cached by prefetchSummary —
   * so this returns instantly. Falls back to on-demand prep if not.
   */
  async function getSpeechText(message) {
    const cached = summaryCacheRef.current[message.id]
    if (cached) return cached
    const job = summaryJobsRef.current[message.id] || prefetchSummary(message)
    if (job) await job
    return summaryCacheRef.current[message.id] ?? (message.text || '')
  }

  // Restore a signed-in account on page load
  useEffect(() => {
    getAccount()
      .then((acc) => setAccount(acc))
      .finally(() => setBooting(false))
  }, [])

  // Once signed in, open the conversation
  useEffect(() => {
    if (!account || sessionRef.current) return
    const session = new GailexaSession()
    sessionRef.current = session
    setStatus('connecting')
    session
      .start((activity) => handleActivity(activity))
      .then(() => {
        setStatus('ready')
        if (lastBotRef.current) prefetchSummary(lastBotRef.current)
      })
      .catch((e) => {
        console.error(e)
        setError(describeError(e))
        setStatus('error')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account])

  function handleActivity(activity) {
    if (!activity || !activity.type) return
    if (activity.type === 'message' && (activity.text || activity.suggestedActions)) {
      const botMessage = {
          id: nextId(),
          role: 'bot',
          text: activity.text || '',
          citations: extractCitations(activity),
          actions:
            activity.suggestedActions?.actions?.map((a) => a.title || a.value).filter(Boolean) ??
            [],
          at: new Date(),
      }
      lastBotRef.current = botMessage
      setMessages((prev) => [...prev, botMessage])
    }
  }

  async function handleSignIn() {
    setError(null)
    try {
      const acc = await signIn()
      setAccount(acc)
    } catch (e) {
      console.error(e)
      setError(describeError(e))
    }
  }

  async function handleSignOut() {
    await signOut()
    sessionRef.current = null
    setAccount(null)
    setMessages([])
    setStatus('idle')
  }

  /**
   * Send a turn to GAILexa.
   *
   * Copilot Studio always receives ENGLISH, and the chat shows English —
   * so the knowledge base, citations and instructions work unchanged. When
   * the person spoke another language, `meta.original` carries their own
   * words (shown beneath the English) and `meta.locale` records the language
   * so the answer can be read back to them in it.
   */
  async function handleSend(text, meta = {}) {
    const trimmed = (text || '').trim()
    if (!trimmed || status === 'thinking' || status === 'connecting') return
    setError(null)
    if (meta.locale) setVoiceLocale(meta.locale)
    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        role: 'user',
        text: trimmed,
        originalText: meta.original && meta.original !== trimmed ? meta.original : null,
        locale: meta.locale || null,
        at: new Date(),
      },
    ])
    setStatus('thinking')
    try {
      await drainSummaryJobs() // never overlap a hidden request with a user turn
      await sessionRef.current.send(trimmed, (activity) => handleActivity(activity))
      setStatus('ready')
      // Fire-and-forget: prepare the voice summary while the user reads
      if (lastBotRef.current) prefetchSummary(lastBotRef.current)
    } catch (e) {
      console.error(e)
      setError(describeError(e))
      setStatus('ready')
    }
  }

  /**
   * One question from the hands-free voice screen.
   *
   * The turn still goes through the same Copilot Studio conversation and is
   * recorded in the chat, so the history is there when the person returns to
   * the written view. What comes back is the SHORT version — a long answer is
   * summarised first, because it has to be listened to rather than read.
   *
   * @param   {string} englishText  the question, already translated to English
   * @param   {string} locale       the language the person spoke
   * @returns {Promise<string>}     the answer in English, ready to be spoken
   */
  async function askForTalk(englishText, locale) {
    const trimmed = (englishText || '').trim()
    if (!trimmed) return ''
    if (locale) setVoiceLocale(locale)

    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', text: trimmed, locale: locale || null, at: new Date() },
    ])
    setStatus('thinking')

    const before = lastBotRef.current
    try {
      await drainSummaryJobs()
      await sessionRef.current.send(trimmed, (activity) => handleActivity(activity))
      setStatus('ready')

      const reply = lastBotRef.current
      if (!reply || reply === before) return ''

      // Spoken answers must be short — reuse the same summariser the play
      // button uses, so nothing new is invented and nothing is repeated.
      const spoken = await getSpeechText(reply)
      return (spoken || reply.text || '').trim()
    } catch (e) {
      console.error(e)
      setError(describeError(e))
      setStatus('ready')
      return ''
    }
  }

  if (booting) return <div className="boot" />

  if (!account) {
    return (
      <SignIn
        onSignIn={handleSignIn}
        error={error}
        missingConfig={missingConfig}
      />
    )
  }

  return (
    <Chat
      account={account}
      messages={messages}
      status={status}
      error={error}
      onSend={handleSend}
      onSignOut={handleSignOut}
      getSpeechText={getSpeechText}
      voiceLocale={voiceLocale}
      onVoiceLocaleChange={setVoiceLocale}
      onAskForTalk={askForTalk}
    />
  )
}

function describeError(e) {
  const msg = String(e?.message || e || 'Something went wrong.')
  if (msg.includes('AADSTS')) {
    return `Microsoft sign-in failed: ${msg}. Check the app registration, redirect URI, and API permissions.`
  }
  if (msg.toLowerCase().includes('failed to fetch')) {
    return 'Could not reach Copilot Studio. Check the connection string and your network, then try again.'
  }
  return msg
}
