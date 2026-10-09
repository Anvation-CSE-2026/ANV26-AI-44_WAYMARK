import { Logo } from './Logo'

export function Footer() {
  return (
      <footer className="mt-auto border-t border-ivory/15 bg-navy text-ivory/90">
      <div className="mx-auto flex h-28 max-w-6xl flex-col justify-center gap-3 px-4 md:h-[76px] md:flex-row md:items-center md:justify-between md:gap-4">
        <Logo tone="dark" size={28} />
        <div className="max-w-2xl text-sm leading-relaxed md:text-right">
          <p className="font-medium text-ivory">
            WAYMARK is decision support only. Human experts decide. Indicative result: one city, one backtest.
          </p>
          <p className="mt-1 text-ivory/70">
            Data: US Accidents (2016–2023), a countrywide traffic accident dataset by Sobhan Moosavi et al.
          </p>
        </div>
      </div>
      </footer>
  )
}
