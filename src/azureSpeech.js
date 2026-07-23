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
 * Recognise one utterance from the microphone.
 *
 * @param {object} opts
 * @param {string} [opts.locale]  force a single language; omit for auto-detect
 * @returns {Promise<{ text: string, locale: string }>}
 */
export function recognise({ locale } = {}) {
  return new Promise(async (resolve, reject) => {
    let recogniser = null
    try {
      const runPass = (langs) =>
        new Promise(async (res, rej) => {
          const cfg = await speechConfig()
          const audio = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
          let rec
          if (langs.length === 1) {
            cfg.speechRecognitionLanguage = langs[0]
            rec = new SpeechSDK.SpeechRecognizer(cfg, audio)
          } else {
            const detect = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(langs)
            rec = SpeechSDK.SpeechRecognizer.FromConfig(cfg, detect, audio)
          }
          recogniser = rec
          rec.recognizeOnceAsync(
            (result) => {
              let detected = langs.length === 1 ? langs[0] : null
              try {
                detected =
                  SpeechSDK.AutoDetectSourceLanguageResult.fromResult(result)?.language || detected
              } catch { /* single-language pass */ }
              rec.close()
              recogniser = null
              res({ result, locale: detected })
            },
            (err) => { rec.close(); recogniser = null; rej(new Error(err)) }
          )
        })

      const passes = locale ? [[locale]] : [DETECT_GROUP_A, DETECT_GROUP_B]
      let text = ''
      let detectedLocale = locale || 'en-IN'

      for (const langs of passes) {
        const { result, locale: got } = await runPass(langs)
        if (result.reason === SpeechSDK.ResultReason.RecognizedSpeech && result.text?.trim()) {
          text = result.text.trim()
          detectedLocale = normaliseLocale(got)
          break
        }
        if (result.reason === SpeechSDK.ResultReason.Canceled) {
          const details = SpeechSDK.CancellationDetails.fromResult(result)
          if (/token|auth|forbidden|401|403/i.test(details.errorDetails || '')) invalidateToken()
          throw new Error(details.errorDetails || 'Speech recognition was cancelled')
        }
        // No match on group A → fall through and try the regional group
      }

      resolve({ text, locale: detectedLocale })
    } catch (e) {
      try { recogniser?.close() } catch { /* ignore */ }
      reject(e)
    }
  })
}

// --- Text to speech --------------------------------------------------------
let activeSynth = null

/** Speak `text` in the voice matching `locale`. Resolves when playback ends. */
export function speak(text, locale) {
  return new Promise(async (resolve, reject) => {
    try {
      stopSpeaking()
      const cfg = await speechConfig()
      cfg.speechSynthesisVoiceName = voiceFor(locale)
      const synth = new SpeechSDK.SpeechSynthesizer(cfg)
      activeSynth = synth
      synth.speakTextAsync(
        text,
        (result) => {
          const ok = result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted
          try { synth.close() } catch { /* ignore */ }
          if (activeSynth === synth) activeSynth = null
          if (ok) resolve()
          else {
            if (/token|auth|401|403/i.test(result.errorDetails || '')) invalidateToken()
            reject(new Error(result.errorDetails || 'Speech synthesis failed'))
          }
        },
        (err) => {
          try { synth.close() } catch { /* ignore */ }
          if (activeSynth === synth) activeSynth = null
          reject(new Error(err))
        }
      )
    } catch (e) {
      reject(e)
    }
  })
}

export function stopSpeaking() {
  if (activeSynth) {
    try { activeSynth.close() } catch { /* ignore */ }
    activeSynth = null
  }
}
