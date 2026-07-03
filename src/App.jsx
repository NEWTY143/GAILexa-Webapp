import { useEffect, useRef, useState } from 'react'
import { getAccount, signIn, signOut } from './auth.js'
import { GailexaSession } from './copilot.js'
import { validateConfig } from './config.js'
import SignIn from './components/SignIn.jsx'
import Chat from './components/Chat.jsx'

let messageCounter = 0
const nextId = () => `m-${++messageCounter}`

export default function App() {
  const [account, setAccount] = useState(null)
  const [booting, setBooting] = useState(true)
  const [messages, setMessages] = useState([])
  const [status, setStatus] = useState('idle') // idle | connecting | ready | thinking | error
  const [error, setError] = useState(null)
  const sessionRef = useRef(null)
  const missingConfig = validateConfig()

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
      .then(() => setStatus('ready'))
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
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'bot',
          text: activity.text || '',
          actions:
            activity.suggestedActions?.actions?.map((a) => a.title || a.value).filter(Boolean) ??
            [],
          at: new Date(),
        },
      ])
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

  async function handleSend(text) {
    const trimmed = text.trim()
    if (!trimmed || status === 'thinking' || status === 'connecting') return
    setError(null)
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', text: trimmed, at: new Date() },
    ])
    setStatus('thinking')
    try {
      await sessionRef.current.send(trimmed, (activity) => handleActivity(activity))
      setStatus('ready')
    } catch (e) {
      console.error(e)
      setError(describeError(e))
      setStatus('ready')
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
