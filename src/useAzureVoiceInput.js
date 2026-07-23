import { useCallback, useEffect, useRef, useState } from 'react'
import { recognise, toEnglish, normaliseLocale } from './azureSpeech.js'

/**
 * Voice input through Azure AI Speech.
 *
 * One tap starts recognition; Azure decides when the speaker has stopped.
 * The recognised text is translated to English (Copilot Studio always works
 * in English) and handed back together with the language that was detected,
 * so the answer can later be spoken in that same language.
 *
 * phase: 'idle' | 'listening' | 'processing'
 */
export function useAzureVoiceInput({ forcedLocale, onResult, onError } = {}) {
  const [phase, setPhase] = useState('idle')
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef(null)
  const cancelledRef = useRef(false)

  const supported =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)

  useEffect(() => () => clearInterval(timerRef.current), [])

  const stopTimer = () => {
    clearInterval(timerRef.current)
    timerRef.current = null
    setElapsed(0)
  }

  const toggle = useCallback(async () => {
    if (phase === 'listening') {
      // Azure ends the utterance itself; this just abandons the result.
      cancelledRef.current = true
      stopTimer()
      setPhase('idle')
      return
    }
    if (phase === 'processing') return

    cancelledRef.current = false
    setPhase('listening')
    setElapsed(0)
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)

    try {
      const { text, locale } = await recognise({ locale: forcedLocale || undefined })
      stopTimer()
      if (cancelledRef.current) { setPhase('idle'); return }
      if (!text) { setPhase('idle'); return }

      setPhase('processing')
      const detected = normaliseLocale(locale)
      const english = await toEnglish(text, detected)
      if (cancelledRef.current) { setPhase('idle'); return }

      onResult?.({ original: text, english, locale: detected })
      setPhase('idle')
    } catch (e) {
      stopTimer()
      setPhase('idle')
      console.error('[GAILexa] voice input failed:', e)
      onError?.(e)
    }
  }, [phase, forcedLocale, onResult, onError])

  return {
    supported,
    phase,
    listening: phase === 'listening',
    processing: phase === 'processing',
    elapsed,
    toggle,
  }
}
