import FlameOrb from './FlameOrb.jsx'

export default function SignIn({ onSignIn, error, missingConfig }) {
  const configOk = missingConfig.length === 0
  return (
    <div className="signin">
      <div className="signin__pipes" aria-hidden="true" />
      <div className="signin__card">
        <FlameOrb size={64} />
        <h1 className="signin__title">GAILexa</h1>
        <p className="signin__sub">
          GAIL&rsquo;s AI assistant. Sign in with your Microsoft work account to start a
          conversation.
        </p>

        {!configOk && (
          <div className="notice notice--warn">
            <strong>Setup needed:</strong> add {missingConfig.join(', ')} to your{' '}
            <code>.env</code> file (see README.md), then restart the app.
          </div>
        )}

        {error && <div className="notice notice--error">{error}</div>}

        <button className="btn btn--ms" onClick={onSignIn} disabled={!configOk}>
          <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          Sign in with Microsoft
        </button>

        <p className="signin__foot">Powered by Microsoft Copilot Studio</p>
      </div>
    </div>
  )
}
