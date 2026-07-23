import { useEffect, useRef, useState } from 'react'
import { speak as azureSpeak, stopSpeaking as azureStop, fromEnglish, isEnglish } from './azureSpeech.js'
import { appConfig } from './config.js'

/** Strip markdown so the spoken text sounds natural. */
export function markdownToPlainText(md = '') {
  return md
    .replace(/```[\s\S]*?```/g, ' code block omitted. ') // code blocks
    .replace(/^\s*\[\d+\]:\s.*$/gm, '') // citation definitions: [1]: cite:1 "Doc"
    .replace(/\(\[?\d{1,2}\]?\)/g, '') // parenthesised citations: ([1]) (1)
    .replace(/\[\^?\d+\^?\]/g, '') // inline citation markers: [1], [^1]
    .replace(/[\u00B9\u00B2\u00B3\u2070\u2074-\u2079\u207A-\u207E]+/g, '') // superscript digits: ¹ ² ³
    .replace(/cite:\d+/gi, '') // raw cite tokens
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → link text
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/[*_~>#]/g, '') // emphasis, quotes
    .replace(/^\s*[-+]\s+/gm, '') // bullets
    .replace(/\|/g, ', ') // tables
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Voice character: ONE consistent female voice, every time.
//
// 1) Preferred: neural TTS from the backend (/tts, edge-tts) —
//    en-IN "Neerja" for English, hi-IN "Swara" for Hindi. Warm, natural,
//    human-sounding, and identical on every browser and device.
// 2) Fallback (no backend / request failed): the browser's speechSynthesis,
//    restricted to a fixed, priority-ordered list of FEMALE voices only.
//    The chosen voice is cached so it never changes mid-session, and a
//    male-name blocklist guarantees a male voice is never selected.
// ---------------------------------------------------------------------------

// Priority order — first match wins. Indian female voices first.
const FEMALE_PRIORITY = [
  'neerja', 'swara', 'heera', 'priya', 'veena', 'lekha', 'kalpana', 'ananya', 'aarohi', // Indian
  'sonia', 'libby', 'maisie', 'jenny', 'aria', 'michelle', 'emma', 'ava',               // MS/neural English
  'natasha', 'clara', 'zira', 'hazel', 'susan', 'samantha', 'karen', 'moira', 'tessa',  // other female
]
const MALE_BLOCKLIST = [
  'ravi', 'hemant', 'prabhat', 'madhur', 'david', 'mark', 'guy', 'ryan', 'thomas',
  'george', 'james', 'daniel', 'alex', 'fred', 'male', 'man',
]

export function useSpeechOutput({ endpoint = '' } = {}) {
  const azureOn = Boolean(appConfig.azureSpeechEnabled)
  const [speakingId, setSpeakingId] = useState(null)
  const audioRef = useRef(null)          // neural playback element
  const abortRef = useRef(null)          // cancels an in-flight /tts fetch
  const chosenVoiceRef = useRef({})      // cached browser voice per language

  const browserSupported =
    typeof window !== 'undefined' && 'speechSynthesis' in window
  const supported = azureOn || Boolean(endpoint) || browserSupported

  // Voice list loads asynchronously in most browsers — warm it up.
  useEffect(() => {
    if (!browserSupported) return
    const load = () => window.speechSynthesis.getVoices()
    load()
    window.speechSynthesis.addEventListener?.('voiceschanged', load)
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', load)
      window.speechSynthesis.cancel()
      stopAudio()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserSupported])

  function stopAudio() {
    abortRef.current?.abort()
    abortRef.current = null
    const a = audioRef.current
    if (a) {
      a.pause()
      if (a.src) URL.revokeObjectURL(a.src)
      audioRef.current = null
    }
  }

  function stopAll() {
    azureStop()
    stopAudio()
    if (browserSupported) window.speechSynthesis.cancel()
    setSpeakingId(null)
  }

  /** Deterministic FEMALE-ONLY browser voice, cached per language. */
  function pickFemaleVoice(lang) {
    if (chosenVoiceRef.current[lang]) return chosenVoiceRef.current[lang]
    const voices = window.speechSynthesis.getVoices()
    if (!voices.length) return null

    const name = (v) => v.name.toLowerCase()
    const notMale = (v) => !MALE_BLOCKLIST.some((m) => name(v).includes(m))
    const femaleRank = (v) => {
      const i = FEMALE_PRIORITY.findIndex((f) => name(v).includes(f))
      return i === -1 ? Infinity : i
    }
    const langScore = (v) => {
      const l = (v.lang || '').toLowerCase()
      if (l === lang.toLowerCase()) return 0            // exact: en-IN / hi-IN
      if (l.startsWith(lang.split('-')[0].toLowerCase())) return 1 // same language
      return 2
    }

    const candidates = voices
      .filter(notMale)
      .filter((v) => femaleRank(v) !== Infinity || /female|woman/i.test(v.name))
      .sort((a, b) => langScore(a) - langScore(b) || femaleRank(a) - femaleRank(b))

    const voice = candidates[0] || null // never fall back to an unknown (possibly male) voice
    if (voice) chosenVoiceRef.current[lang] = voice
    return voice
  }

  /** Neural female voice from the backend. Returns false if unavailable. */
  async function speakNeural(id, text, lang) {
    if (!endpoint) return false
    try {
      const controller = new AbortController()
      abortRef.current = controller
      const res = await fetch(`${endpoint.replace(/\/$/, '')}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang: lang.startsWith('hi') ? 'hi' : 'en' }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`TTS service returned ${res.status}`)
      const blob = await res.blob()
      if (!blob.size) throw new Error('Empty audio')

      const audio = new Audio(URL.createObjectURL(blob))
      audioRef.current = audio
      audio.onended = () => { stopAudio(); setSpeakingId(null) }
      audio.onerror = () => { stopAudio(); setSpeakingId(null) }
      await audio.play()
      return true
    } catch (err) {
      if (err?.name !== 'AbortError') console.warn('Neural TTS unavailable, falling back to browser voice:', err)
      stopAudio()
      return false
    }
  }

  function speakBrowser(id, text, lang) {
    if (!browserSupported) { setSpeakingId(null); return }
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    // Warm, unhurried delivery — like someone reading the text to you
    utterance.rate = 0.95
    utterance.pitch = 1.08
    const voice = pickFemaleVoice(lang)
    if (voice) utterance.voice = voice
    utterance.onend = () => setSpeakingId(null)
    utterance.onerror = () => setSpeakingId(null)
    window.speechSynthesis.speak(utterance)
  }

  /**
   * Azure path: GAILexa answers in English, so the text is translated into
   * the language the person actually spoke before it is read aloud, using
   * that language's female neural voice.
   */
  async function speakAzure(id, text, locale) {
    try {
      const spoken = isEnglish(locale) ? text : await fromEnglish(text, locale)
      await azureSpeak(spoken, locale)
      setSpeakingId(null)
      return true
    } catch (err) {
      console.warn('[GAILexa] Azure speech unavailable, falling back:', err)
      return false
    }
  }

  /**
   * @param {string} id            message id (tapping the same id stops playback)
   * @param {string} markdownText  the answer, as markdown
   * @param {string} [locale]      language to speak in — the language the
   *                               person used. Defaults to the script of the
   *                               text itself when no locale is known.
   */
  async function toggleSpeak(id, markdownText, locale) {
    if (!supported) return

    // Tapping the message that's already playing stops it
    if (speakingId === id) { stopAll(); return }

    stopAll() // stop anything else first
    const text = markdownToPlainText(markdownText)
    if (!text) return

    // Without an explicit locale, fall back to detecting Devanagari script.
    const hasDevanagari = /[\u0900-\u097F]/.test(text)
    const lang = locale || (hasDevanagari ? 'hi-IN' : 'en-IN')

    setSpeakingId(id)

    if (azureOn) {
      const ok = await speakAzure(id, text, lang)
      if (ok) return
      // Azure failed — continue to the legacy paths below
    }

    const ok = await speakNeural(id, text, lang)
    if (!ok) speakBrowser(id, text, lang)
  }

  return { supported, speakingId, toggleSpeak }
}
