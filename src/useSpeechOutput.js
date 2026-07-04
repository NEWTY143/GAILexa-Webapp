import { useEffect, useState } from 'react'

/** Strip markdown so the spoken text sounds natural. */
export function markdownToPlainText(md = '') {
  return md
    .replace(/```[\s\S]*?```/g, ' code block omitted. ') // code blocks
    .replace(/^\s*\[\d+\]:\s.*$/gm, '') // citation definitions: [1]: cite:1 "Doc"
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

/**
 * Voice-note style playback using the browser's built-in speechSynthesis.
 * No package, no API key. Detects Devanagari to pick a Hindi voice.
 *
 * Usage:
 *   const { supported, speakingId, toggleSpeak } = useSpeechOutput()
 *   toggleSpeak(message.id, message.text)   // play; call again to stop
 */
export function useSpeechOutput() {
  const [speakingId, setSpeakingId] = useState(null)
  const supported =
    typeof window !== 'undefined' && 'speechSynthesis' in window

  // Stop any playback when the component unmounts (e.g. sign-out)
  useEffect(() => {
    return () => {
      if (supported) window.speechSynthesis.cancel()
    }
  }, [supported])

  function toggleSpeak(id, markdownText) {
    if (!supported) return

    // Tapping the message that's already playing stops it
    if (speakingId === id) {
      window.speechSynthesis.cancel()
      setSpeakingId(null)
      return
    }

    window.speechSynthesis.cancel() // stop anything else first
    const text = markdownToPlainText(markdownText)
    if (!text) return

    const utterance = new SpeechSynthesisUtterance(text)
    const hasDevanagari = /[\u0900-\u097F]/.test(text)
    utterance.lang = hasDevanagari ? 'hi-IN' : 'en-IN'
    utterance.rate = 1

    // Prefer a matching installed voice if the browser has one
    const voices = window.speechSynthesis.getVoices()
    const match = voices.find((v) => v.lang === utterance.lang)
    if (match) utterance.voice = match

    utterance.onend = () => setSpeakingId(null)
    utterance.onerror = () => setSpeakingId(null)

    setSpeakingId(id)
    window.speechSynthesis.speak(utterance)
  }

  return { supported, speakingId, toggleSpeak }
}
