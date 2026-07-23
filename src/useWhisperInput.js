import { useEffect, useRef, useState } from 'react'

/**
 * Voice input via the faster-whisper backend.
 * Records up to maxSeconds (default 10s) with MediaRecorder, uploads the clip to
 * `${endpoint}/transcribe`, and returns the text + detected language
 * ('en', 'hi', …). Whisper detects the language automatically — no toggle.
 *
 * Phases: 'idle' → 'recording' → 'transcribing' → 'idle'
 */
export function useWhisperInput({ endpoint, maxSeconds = 10, onResult }) {
  const [phase, setPhase] = useState('idle')
  const [elapsed, setElapsed] = useState(0)
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const timersRef = useRef({})
  const resultRef = useRef(onResult)
  resultRef.current = onResult

  const supported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined'

  function clearTimers() {
    clearTimeout(timersRef.current.cap)
    clearInterval(timersRef.current.tick)
  }

  useEffect(() => {
    return () => {
      clearTimers()
      const rec = recorderRef.current
      if (rec && rec.state === 'recording') rec.stop()
      rec?.stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  async function start() {
    if (phase !== 'idle') return
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : undefined
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    chunksRef.current = []

    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    rec.onstop = async () => {
      clearTimers()
      setElapsed(0)
      stream.getTracks().forEach((t) => t.stop())

      const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
      if (blob.size < 1200) {
        // essentially silence — nothing to transcribe
        setPhase('idle')
        return
      }

      setPhase('transcribing')
      try {
        const form = new FormData()
        form.append('audio', blob, 'clip.webm')
        const res = await fetch(`${endpoint.replace(/\/$/, '')}/transcribe`, {
          method: 'POST',
          body: form,
        })
        if (!res.ok) throw new Error(`Whisper service returned ${res.status}`)
        const data = await res.json()
        resultRef.current?.((data.text || '').trim(), data.language || null)
      } catch (err) {
        console.error('Whisper transcription failed:', err)
        resultRef.current?.('', null, err)
      }
      setPhase('idle')
    }

    recorderRef.current = rec
    setPhase('recording')
    setElapsed(0)
    rec.start()

    timersRef.current.cap = setTimeout(() => {
      if (rec.state === 'recording') rec.stop()
    }, maxSeconds * 1000)
    timersRef.current.tick = setInterval(() => setElapsed((s) => s + 1), 1000)
  }

  function stop() {
    const rec = recorderRef.current
    if (rec && rec.state === 'recording') rec.stop()
  }

  function toggle() {
    if (phase === 'recording') stop()
    else if (phase === 'idle')
      start().catch((err) => {
        console.error('Microphone access failed:', err)
        setPhase('idle')
      })
  }

  return { supported, phase, elapsed, toggle }
}
