import { useEffect, useRef, useState } from 'react'

/**
 * Voice input via the browser's built-in Web Speech API.
 * No server, no API key — recognition runs in the browser (Chrome/Edge).
 *
 * Usage:
 *   const { supported, listening, toggle } = useSpeechInput({
 *     lang: 'en-IN',
 *     maxSeconds: 30,
 *     onTranscript: (text, isFinal) => ...,
 *     onEnd: () => ...,          // fires when listening stops (pause, cap, or tap)
 *   })
 */
export function useSpeechInput({ lang = 'en-IN', maxSeconds = 30, onTranscript, onEnd }) {
  const [listening, setListening] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const recognitionRef = useRef(null)
  const timersRef = useRef({ cap: null, tick: null })
  const callbackRef = useRef(onTranscript)
  const endRef = useRef(onEnd)
  callbackRef.current = onTranscript
  endRef.current = onEnd

  const SR =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : undefined
  const supported = Boolean(SR)

  function clearTimers() {
    clearTimeout(timersRef.current.cap)
    clearInterval(timersRef.current.tick)
  }

  useEffect(() => {
    return () => {
      clearTimers()
      recognitionRef.current?.abort()
    }
  }, [])

  function stop() {
    recognitionRef.current?.stop()
  }

  function start() {
    if (!SR || listening) return
    const rec = new SR()
    rec.lang = lang
    rec.interimResults = true // show words as they are spoken
    rec.continuous = true // keep listening through short pauses, up to the cap

    rec.onresult = (event) => {
      let transcript = ''
      let isFinal = false
      for (const result of event.results) {
        transcript += result[0].transcript
        if (result.isFinal) isFinal = true
      }
      callbackRef.current?.(transcript.trim(), isFinal)
    }
    rec.onend = () => {
      clearTimers()
      setListening(false)
      setElapsed(0)
      endRef.current?.()
    }
    rec.onerror = (e) => {
      console.warn('Speech recognition error:', e.error)
      // onend fires after onerror and handles cleanup + auto-send
    }

    recognitionRef.current = rec
    setListening(true)
    setElapsed(0)
    rec.start()

    // Hard cap: stop automatically after maxSeconds
    timersRef.current.cap = setTimeout(() => rec.stop(), maxSeconds * 1000)
    timersRef.current.tick = setInterval(() => setElapsed((s) => s + 1), 1000)
  }

  function toggle() {
    listening ? stop() : start()
  }

  return { supported, listening, elapsed, toggle }
}
