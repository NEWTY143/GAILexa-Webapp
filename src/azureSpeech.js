// ---------------------------------------------------------------------------
// GAILexa — Azure AI Speech + Translator layer
//
// Three capabilities, all reached through the GAIL backend so that the Azure
// key never ships inside the browser bundle:
//
//   recognise(...)  speech → text, with automatic language detection
//   toEnglish(...)  any supported language → English (for Copilot Studio)
//   fromEnglish(..) English → the user's language (for playback)
//   speak(...)      text → audio in the matching female neural voice
//
// The backend exposes /speech/token (short-lived Speech token) and /translate
// (proxied so the key stays server-side). See server/main.py.
// ---------------------------------------------------------------------------

import * as SpeechSDK from 'microsoft-cognitiveservices-speech-sdk'
import { appConfig } from './config.js'

// --- Language → voice map --------------------------------------------------
// One consistent female voice per language. Hinglish is spoken by the Hindi
// voice (Swara), which handles Roman-script English words inside Hindi well.
export const VOICE_MAP = {
  'en-IN': 'en-IN-NeerjaNeural',
  'hi-IN': 'hi-IN-SwaraNeural',
  'bn-IN': 'bn-IN-TanishaaNeural',
  'mr-IN': 'mr-IN-AarohiNeural',
  'te-IN': 'te-IN-ShrutiNeural',
  'gu-IN': 'gu-IN-DhwaniNeural',
  'ta-IN': 'ta-IN-PallaviNeural',
}

export const LANGUAGE_NAMES = {
  'en-IN': 'English',
  'hi-IN': 'हिन्दी',
  'bn-IN': 'বাংলা',
  'mr-IN': 'मराठी',
  'te-IN': 'తెలుగు',
  'gu-IN': 'ગુજરાતી',
  'ta-IN': 'தமிழ்',
}

// Azure allows at most 4 candidate languages per recogniser, so detection runs
// in two passes: the most common languages first, regional ones as a fallback.
const DETECT_GROUP_A = ['en-IN', 'hi-IN', 'bn-IN', 'mr-IN']
const DETECT_GROUP_B = ['en-IN', 'te-IN', 'gu-IN', 'ta-IN']

export const SUPPORTED_LOCALES = Object.keys(VOICE_MAP)

export function voiceFor(locale) {
  if (!locale) return VOICE_MAP['en-IN']
  const clean = String(locale).toLowerCase().replace('_', '-')
  if (VOICE_MAP[clean]) return VOICE_MAP[clean]
  const base = clean.split('-')[0]
  const match = SUPPORTED_LOCALES.find((l) => l.toLowerCase().startsWith(base))
  return match ? VOICE_MAP[match] : VOICE_MAP['en-IN']
}

/** Normalise anything Azure returns ("hi", "hi-IN", "en-US") to a supported locale. */
export function normaliseLocale(locale) {
  if (!locale) return 'en-IN'
  const clean = String(locale).toLowerCase().replace('_', '-')
  if (VOICE_MAP[clean]) return clean
  const base = clean.split('-')[0]
  return SUPPORTED_LOCALES.find((l) => l.toLowerCase().startsWith(base)) || 'en-IN'
}

export const isEnglish = (locale) => normaliseLocale(locale).startsWith('en')

// --- Backend helpers -------------------------------------------------------
const api = () => (appConfig.whisperUrl || '').replace(/\/$/, '')

/** Short-lived Speech token, cached until shortly before it expires (10 min). */
let tokenCache = { token: null, region: null, expires: 0 }
async function getSpeechToken() {
  const now = Date.now()
  if (tokenCache.token && now < tokenCache.expires) return tokenCache
  const res = await fetch(`${api()}/speech/token`, { method: 'POST' })
  if (!res.ok) throw new Error(`Speech token request failed (${res.status})`)
  const data = await res.json()
  if (!data?.token) throw new Error('Speech token missing from response')
  tokenCache = {
    token: data.token,
    region: data.region || appConfig.azureSpeechRegion,
    expires: now + 8 * 60 * 1000, // Azure tokens last 10 min; refresh at 8
  }
  return tokenCache
}

function invalidateToken() {
  tokenCache = { token: null, region: null, expires: 0 }
}

/** True when a key is configured in the frontend (testing mode, no backend). */
const directMode = () => Boolean(appConfig.azureSpeechKey)

async function speechConfig() {
  if (directMode()) {
    return SpeechSDK.SpeechConfig.fromSubscription(
      appConfig.azureSpeechKey,
      appConfig.azureSpeechRegion
    )
  }
  const { token, region } = await getSpeechToken()
  return SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region)
}

// --- Translation -----------------------------------------------------------
/**
 * Translate through the backend proxy. `to` is a plain language code
 * ("en", "hi", "te"); `from` may be omitted to let Azure detect it.
 * Returns the translated text, or the original if anything fails — voice
 * features must never break the conversation.
 */
const TRANSLATOR_ENDPOINT = 'https://api.cognitive.microsofttranslator.com'

async function translate(text, to, from) {
  // Direct mode — call Azure Translator straight from the browser.
  if (directMode()) {
    let params = `?api-version=3.0&to=${to}`
    if (from) params += `&from=${from}`
    const res = await fetch(`${TRANSLATOR_ENDPOINT}/translate${params}`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': appConfig.azureSpeechKey,
        'Ocp-Apim-Subscription-Region': appConfig.azureSpeechRegion,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ text }]),
    })
    if (!res.ok) throw new Error(`Translation failed (${res.status})`)
    const data = await res.json()
    const first = data?.[0] || {}
    return {
      text: first.translations?.[0]?.text || '',
      detected: first.detectedLanguage?.language || null,
    }
  }

  // Proxied mode — the backend holds the key.
  const body = { text, to }
  if (from) body.from = from
  const res = await fetch(`${api()}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Translation failed (${res.status})`)
  const data = await res.json()
  return { text: data.text || '', detected: data.detected || null }
}

/** User's speech (any supported language) → English, for Copilot Studio. */
export async function toEnglish(text, sourceLocale) {
  if (!text?.trim()) return text
  if (isEnglish(sourceLocale)) return text
  try {
    const { text: translated } = await translate(text, 'en', normaliseLocale(sourceLocale).split('-')[0])
    return translated || text
  } catch (e) {
    console.warn('[GAILexa] toEnglish failed, sending original text:', e)
    return text
  }
}

/** GAILexa's English answer → the user's language, for playback. */
export async function fromEnglish(text, targetLocale) {
  if (!text?.trim()) return text
  if (isEnglish(targetLocale)) return text
  try {
    const { text: translated } = await translate(text, normaliseLocale(targetLocale).split('-')[0], 'en')
    return translated || text
  } catch (e) {
    console.warn('[GAILexa] fromEnglish failed, speaking English:', e)
    return text
  }
}

// --- Speech to text --------------------------------------------------------

/**
 * Ask for microphone permission explicitly before handing control to the SDK.
 *
 * Mobile browsers only grant microphone access in response to a user gesture,
 * and they refuse silently if the SDK opens the device on its own. Requesting
 * the stream here — and releasing it immediately — makes the prompt appear at
 * the moment the person taps, which is what mobile requires.
 */
export async function ensureMicPermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not support microphone access.')
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  stream.getTracks().forEach((t) => t.stop())
}

/**
 * Recognise speech from the microphone.
 *
 * Continuous recognition is used so that longer sentences are not cut off in
 * the middle: fragments are collected until the person stops speaking or the
 * time limit is reached, then joined together.
 *
 * @param {object}   opts
 * @param {string}   [opts.locale]       force one language; omit to auto-detect
 * @param {number}   [opts.maxSeconds]   hard limit on the recording (default 20)
 * @param {number}   [opts.silenceMs]    stop after this much silence (default 1800)
 * @param {function} [opts.onPartial]    called with interim text as it arrives
 * @param {object}   [opts.abortRef]     set .current = true to stop early
 * @returns {Promise<{ text: string, locale: string }>}
 */
export function recognise({
  locale,
  maxSeconds = 20,
  silenceMs = 1800,
  onPartial,
  abortRef,
} = {}) {
  return new Promise(async (resolve, reject) => {
    let rec = null
    let finished = false
    let capTimer = null
    let silenceTimer = null
    const pieces = []
    let detected = locale || null

    const cleanup = () => {
      clearTimeout(capTimer)
      clearTimeout(silenceTimer)
      if (rec) {
        try { rec.stopContinuousRecognitionAsync(() => { try { rec.close() } catch {} }, () => {}) }
        catch { try { rec.close() } catch {} }
        rec = null
      }
    }

    const finish = () => {
      if (finished) return
      finished = true
      cleanup()
      resolve({
        text: pieces.join(' ').replace(/\s+/g, ' ').trim(),
        locale: normaliseLocale(detected || 'en-IN'),
      })
    }

    const armSilence = () => {
      clearTimeout(silenceTimer)
      silenceTimer = setTimeout(() => { if (pieces.length) finish() }, silenceMs)
    }

    try {
      await ensureMicPermission()

      const cfg = await speechConfig()
      // Give people a moment to start speaking, and to pause mid-sentence.
      cfg.setProperty(
        SpeechSDK.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
        String(Math.min(maxSeconds * 1000, 10000))
      )
      cfg.setProperty(
        SpeechSDK.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
        String(silenceMs)
      )

      const audio = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
      if (locale) {
        cfg.speechRecognitionLanguage = locale
        rec = new SpeechSDK.SpeechRecognizer(cfg, audio)
      } else {
        // Azure permits four candidate languages at a time; the most common
        // ones are offered here and the rest can be chosen manually.
        const detectCfg = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(DETECT_GROUP_A)
        rec = SpeechSDK.SpeechRecognizer.FromConfig(cfg, detectCfg, audio)
      }

      rec.recognizing = (_s, e) => {
        if (e.result?.text && onPartial) {
          onPartial([...pieces, e.result.text].join(' ').trim())
        }
        armSilence()
      }

      rec.recognized = (_s, e) => {
        if (e.result?.reason === SpeechSDK.ResultReason.RecognizedSpeech && e.result.text?.trim()) {
          pieces.push(e.result.text.trim())
          try {
            const got = SpeechSDK.AutoDetectSourceLanguageResult.fromResult(e.result)?.language
            if (got) detected = got
          } catch { /* single-language mode */ }
          onPartial?.(pieces.join(' ').trim())
          armSilence()
        }
      }

      rec.canceled = (_s, e) => {
        if (/token|auth|401|403|forbidden/i.test(e.errorDetails || '')) invalidateToken()
        if (pieces.length) return finish()
        if (finished) return
        finished = true
        cleanup()
        reject(new Error(e.errorDetails || 'Speech recognition was cancelled'))
      }

      rec.sessionStopped = () => finish()

      rec.startContinuousRecognitionAsync(
        () => {
          capTimer = setTimeout(finish, maxSeconds * 1000)
          armSilence()
          // Allow the caller to stop us early (a Stop button, or leaving the screen)
          if (abortRef) {
            const poll = setInterval(() => {
              if (finished) return clearInterval(poll)
              if (abortRef.current) { clearInterval(poll); finish() }
            }, 200)
          }
        },
        (err) => {
          if (finished) return
          finished = true
          cleanup()
          reject(new Error(err))
        }
      )
    } catch (e) {
      if (finished) return
      finished = true
      cleanup()
      reject(e)
    }
  })
}

// --- Text to speech --------------------------------------------------------
let activeSynth = null
let activePlayer = null
let activeFinish = null   // resolves the in-flight speak() when stopped early

/**
 * Speak `text` in the voice matching `locale`.
 *
 * The promise resolves when the audio has finished PLAYING, not merely when
 * synthesis completed — the SDK reports those as two different moments, and
 * using the wrong one makes the interface believe playback has ended while
 * the person is still listening.
 *
 * An explicit speaker destination is used so that playback can be interrupted
 * part-way through; the default output offers no way to stop it.
 */
export function speak(text, locale) {
  return new Promise(async (resolve, reject) => {
    try {
      stopSpeaking()
      const cfg = await speechConfig()
      cfg.speechSynthesisVoiceName = voiceFor(locale)

      const player = new SpeechSDK.SpeakerAudioDestination()
      const audioCfg = SpeechSDK.AudioConfig.fromSpeakerOutput(player)
      const synth = new SpeechSDK.SpeechSynthesizer(cfg, audioCfg)
      activePlayer = player
      activeSynth = synth

      let settled = false
      const finish = (fn, arg) => {
        if (settled) return
        settled = true
        try { synth.close() } catch { /* already closed */ }
        if (activeSynth === synth) activeSynth = null
        if (activePlayer === player) activePlayer = null
        if (activeFinish && settled) activeFinish = null
        fn(arg)
      }

      // Fires when the speaker has actually finished playing the audio.
      player.onAudioEnd = () => finish(resolve)
      // Lets stopSpeaking() end this cleanly rather than leaving it pending.
      activeFinish = () => finish(resolve)

      synth.speakTextAsync(
        text,
        (result) => {
          if (result.reason !== SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            if (/token|auth|401|403/i.test(result.errorDetails || '')) invalidateToken()
            finish(reject, new Error(result.errorDetails || 'Speech synthesis failed'))
          }
          // On success we deliberately wait for onAudioEnd instead of
          // resolving here, so the caller knows when playback truly ends.
        },
        (err) => finish(reject, new Error(err))
      )
    } catch (e) {
      reject(e)
    }
  })
}

/** Stop playback immediately, part-way through if necessary. */
export function stopSpeaking() {
  const finishPending = activeFinish
  activeFinish = null
  if (activePlayer) {
    try { activePlayer.pause() } catch { /* ignore */ }
    try { activePlayer.close() } catch { /* ignore */ }
    activePlayer = null
  }
  if (activeSynth) {
    try { activeSynth.close() } catch { /* ignore */ }
    activeSynth = null
  }
  // Release whoever is awaiting playback, so the interface returns to idle.
  finishPending?.()
}
