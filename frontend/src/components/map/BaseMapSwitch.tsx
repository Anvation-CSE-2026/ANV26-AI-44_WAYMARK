interface Props {
  names: string[]
  value: string
  onChange: (name: string) => void
}

/** Visible switch for the base map (Light / Dark / Satellite). */
export function BaseMapSwitch({ names, value, onChange }: Props) {
  if (names.length < 2) return null
  return (
    <div
      role="group"
      aria-label="Base map"
      className="flex gap-1 rounded-full bg-ivory/95 p-1 text-sm font-semibold shadow-card ring-1 ring-navy/10"
    >
      {names.map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={value === n}
          onClick={() => onChange(n)}
          className={`rounded-full px-3.5 py-1.5 ${value === n ? 'bg-navy text-ivory' : 'text-navy hover:bg-navy/10'}`}
        >
          {n}
        </button>
      ))}
    </div>
  )
}
