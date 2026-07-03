export default function FlameOrb({ size = 36, flicker = false }) {
  return (
    <span
      className={`flame-orb${flicker ? ' flame-orb--flicker' : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5}>
        <path
          d="M12 2c1.2 3.4-.6 5-1.8 6.4C8.8 10 8 11.4 8 13.4A4.5 4.5 0 0 0 12.5 18c2.6 0 4.5-2 4.5-4.6 0-2.5-1.3-4.2-2.4-5.6C13.5 6.4 12.6 4.6 12 2Z"
          fill="rgba(255,255,255,0.92)"
        />
      </svg>
    </span>
  )
}
