interface MarkProps {
  size?: number
  className?: string
  title?: string
}

/** Brass hexagon with a small waypoint pin at its centre. */
export function LogoMark({ size = 32, className, title }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <polygon
        points="32,4 56.25,18 56.25,46 32,60 7.75,46 7.75,18"
        fill="#B8893B"
        stroke="#8F6A2B"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M32 47C25 39 22.5 34 22.5 29a9.5 9.5 0 1 1 19 0C41.5 34 39 39 32 47Z" fill="#12203B" />
      <circle cx="32" cy="29" r="3.5" fill="#FAF7F2" />
    </svg>
  )
}

interface LogoProps {
  /** "dark" = wordmark for dark backgrounds (ivory), "light" = for light backgrounds (navy). */
  tone?: 'dark' | 'light'
  size?: number
  /** Extra classes for the WAYMARK wordmark (for example to hide it on very narrow screens). */
  wordmarkClass?: string
}

export function Logo({ tone = 'light', size = 34, wordmarkClass = '' }: LogoProps) {
  return (
    <span className="inline-flex items-center gap-3">
      <LogoMark size={size} />
      <span
        className={`font-serif text-[1.1rem] font-bold leading-none tracking-[0.16em] sm:text-[1.2rem] ${
          tone === 'dark' ? 'text-ivory' : 'text-navy'
        } ${wordmarkClass}`}
      >
        WAYMARK
      </span>
    </span>
  )
}
