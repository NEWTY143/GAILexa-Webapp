import { useCallback, useEffect, useRef, useState } from 'react'
import {
  recognise,
  speak,
  stopSpeaking,
  fromEnglish,
  toEnglish,
  isEnglish,
  normaliseLocale,
  LANGUAGE_NAMES,
} from '../azureSpeech.js'

/**
 * Short holding phrases, spoken while GAILexa is looking something up, so the
 * line never goes silent. Written in the feminine, to match the voices.
 */
const WAIT_PHRASES = {
  'en-IN': ['One moment, let me check that for you.', 'Just a moment, I am looking that up.'],
  'hi-IN': ['एक क्षण, मैं देख रही हूँ।', 'थोड़ा रुकिए, मैं जानकारी देख रही हूँ।'],
  'bn-IN': ['এক মুহূর্ত, আমি দেখছি।', 'একটু অপেক্ষা করুন, আমি খুঁজে দেখছি।'],
  'mr-IN': ['एक क्षण, मी बघते आहे.', 'थोडं थांबा, मी माहिती बघते आहे.'],
  'te-IN': ['ఒక్క క్షణం, నేను చూస్తున్నాను.', 'కొంచెం ఆగండి, నేను సమాచారం చూస్తున్నాను.'],
  'gu-IN': ['એક ક્ષણ, હું જોઈ રહી છું.', 'થોડી વાર રાહ જુઓ, હું માહિતી જોઈ રહી છું.'],
  'ta-IN': ['ஒரு நிமிடம், நான் பார்க்கிறேன்.', 'சற்று காத்திருங்கள், நான் தகவலைப் பார்க்கிறேன்.'],
}

const GREETINGS = {
  'en-IN': 'I am listening. Please ask your question.',
  'hi-IN': 'मैं सुन रही हूँ। कृपया अपना प्रश्न पूछिए।',
  'bn-IN': 'আমি শুনছি। অনুগ্রহ করে আপনার প্রশ্ন করুন।',
  'mr-IN': 'मी ऐकते आहे. कृपया आपला प्रश्न विचारा.',
  'te-IN': 'నేను వింటున్నాను. దయచేసి మీ ప్రశ్న అడగండి.',
  'gu-IN': 'હું સાંભળી રહી છું. કૃપા કરીને તમારો પ્રશ્ન પૂછો.',
  'ta-IN': 'நான் கேட்டுக் கொண்டிருக்கிறேன். உங்கள் கேள்வியைக் கேளுங்கள்.',
}

const NOT_HEARD = {
  'en-IN': 'Sorry, I did not catch that. Please try again.',
  'hi-IN': 'क्षमा कीजिए, मैं समझ नहीं पाई। कृपया दोबारा कहिए।',
  'bn-IN': 'দুঃখিত, আমি বুঝতে পারিনি। আবার বলুন।',
  'mr-IN': 'क्षमा करा, मला समजले नाही. कृपया पुन्हा सांगा.',
  'te-IN': 'క్షమించండి, నాకు అర్థం కాలేదు. మళ్ళీ చెప్పండి.',
  'gu-IN': 'માફ કરશો, હું સમજી શકી નહીં. ફરીથી કહો.',
  'ta-IN': 'மன்னிக்கவும், எனக்குப் புரியவில்லை. மீண்டும் சொல்லுங்கள்.',
}

const STATUS_LABEL = {
  idle: 'Tap to start',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Answering…',
}

const pick = (map, locale) => {
  const key = normaliseLocale(locale)
  const v = map[key] ?? map['en-IN']
  return Array.isArray(v) ? v[Math.floor(Math.random() * v.length)] : v
}

/**
 * Hands-free conversation screen.
 *
 * The person speaks; GAILexa answers aloud in the same language. Nothing is
 * written on screen — this is meant to feel like a phone call rather than a
 * chat window. A holding phrase covers the wait while the agent thinks, and
 * long answers are shortened before they are read out.
 *
 * @param {object}   props
 * @param {string}   props.locale     starting language ('auto' detects it)
 * @param {function} props.onAsk      async (englishText) => English answer
 * @param {function} props.onClose    leave the screen
 */
export default function TalkMode({ locale = 'auto', onAsk, onClose }) {
  const [phase, setPhase] = useState('idle')   // idle | listening | thinking | speaking
  const [activeLocale, setActiveLocale] = useState(
    locale === 'auto' ? 'en-IN' : normaliseLocale(locale)
  )
  const [detected, setDetected] = useState(locale === 'auto' ? null : normaliseLocale(locale))
  const [turns, setTurns] = useState(0)
  const [notice, setNotice] = useState('')

  const abortRef = useRef({ current: false })
  const runningRef = useRef(false)
  const closedRef = useRef(false)

  // Always leave the microphone and speaker released when the screen closes.
  useEffect(() => {
    return () => {
      closedRef.current = true
      abortRef.current.current = true
      stopSpeaking()
    }
  }, [])

  const say = useCallback(async (text, loc) => {
    if (closedRef.current || !text) return
    try { await speak(text, loc) } catch (e) { console.warn('[GAILexa] talk playback:', e) }
  }, [])

  /** One full exchange: listen → translate → ask → translate back → speak. */
  const runTurn = useCallback(async () => {
    if (runningRef.current || closedRef.current) return
    runningRef.current = true
    abortRef.current.current = false
    setNotice('')

    try {
      // --- listen ---------------------------------------------------------
      setPhase('listening')
      const { text, locale: heard } = await recognise({
        locale: locale === 'auto' ? undefined : normaliseLocale(locale),
        maxSeconds: 15,
        silenceMs: 1600,
        abortRef: abortRef.current,
      })
      if (closedRef.current) return

      const spokenLocale = normaliseLocale(heard || activeLocale)
      setDetected(spokenLocale)
      setActiveLocale(spokenLocale)

      if (!text.trim()) {
        setPhase('speaking')
        await say(pick(NOT_HEARD, spokenLocale), spokenLocale)
        setPhase('idle')
        return
      }

      // --- think ----------------------------------------------------------
      setPhase('thinking')
      const english = isEnglish(spokenLocale) ? text : await toEnglish(text, spokenLocale)
      if (closedRef.current) return

      // Cover the wait so the line is never silent
      const waiting = say(pick(WAIT_PHRASES, spokenLocale), spokenLocale)
      const answerEn = await onAsk(english, spokenLocale)
      await waiting
      if (closedRef.current) return

      if (!answerEn) {
        setPhase('idle')
        setNotice('No answer received. Tap to try again.')
        return
      }

      // --- answer ---------------------------------------------------------
      setPhase('speaking')
      const spoken = isEnglish(spokenLocale)
        ? answerEn
        : await fromEnglish(answerEn, spokenLocale)
      if (closedRef.current) return
      await say(spoken, spokenLocale)
      setTurns((n) => n + 1)
      setPhase('idle')
    } catch (e) {
      console.error('[GAILexa] talk mode:', e)
      if (!closedRef.current) {
        setPhase('idle')
        setNotice(
          /permission|denied|NotAllowed/i.test(e?.message || '')
            ? 'Microphone permission is needed. Allow it in your browser and tap again.'
            : 'Something went wrong. Tap to try again.'
        )
      }
    } finally {
      runningRef.current = false
    }
  }, [locale, activeLocale, onAsk, say])

  const stopEverything = () => {
    abortRef.current.current = true
    stopSpeaking()
    runningRef.current = false
    setPhase('idle')
  }

  const handleOrbTap = () => {
    if (phase === 'idle') runTurn()
    else stopEverything()
  }

  const handleClose = () => {
    closedRef.current = true
    abortRef.current.current = true
    stopSpeaking()
    onClose?.()
  }

  const langLabel = detected ? LANGUAGE_NAMES[detected] || detected : 'Detecting…'

  return (
    <div className="talk" role="dialog" aria-modal="true" aria-label="Voice conversation">
      <button className="talk__close" onClick={handleClose} aria-label="Close voice conversation">
        ✕
      </button>

      <div className="talk__body">
        <button
          className={`talk__orb talk__orb--${phase}`}
          onClick={handleOrbTap}
          aria-label={phase === 'idle' ? 'Start speaking' : 'Stop'}
        >
          <span className="talk__orb-core" />
          <span className="talk__orb-ring talk__orb-ring--1" />
          <span className="talk__orb-ring talk__orb-ring--2" />
          <span className="talk__orb-ring talk__orb-ring--3" />
        </button>

        <p className="talk__status">{STATUS_LABEL[phase]}</p>
        <p className="talk__lang">{langLabel}</p>

        {notice && <p className="talk__notice">{notice}</p>}

        <p className="talk__hint">
          {phase === 'idle'
            ? turns === 0
              ? 'Tap the circle and ask your question in any supported language.'
              : 'Tap to ask another question.'
            : 'Tap again to stop.'}
        </p>
      </div>

      <div className="talk__footer">
        {phase !== 'idle' && (
          <button className="talk__stop" onClick={stopEverything}>
            ■ Stop
          </button>
        )}
        <span className="talk__count">{turns > 0 ? `${turns} question${turns > 1 ? 's' : ''} answered` : ''}</span>
      </div>
    </div>
  )
}

export { GREETINGS }
