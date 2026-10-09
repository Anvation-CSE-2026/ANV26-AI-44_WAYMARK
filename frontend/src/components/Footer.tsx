import { useEffect, useState } from 'react'
import { Logo } from './Logo'

export function Footer() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let previousY = window.scrollY

    const updateVisibility = () => {
      const hasScrollableContent = document.documentElement.scrollHeight > window.innerHeight + 8
      if (!hasScrollableContent) {
        setVisible(true)
        previousY = window.scrollY
        return
      }

      const currentY = window.scrollY
      const delta = currentY - previousY
      if (currentY <= 16) setVisible(false)
      else if (delta > 2) setVisible(true)
      else if (delta < -2) setVisible(false)
      previousY = currentY
    }

    updateVisibility()
    window.addEventListener('scroll', updateVisibility, { passive: true })
    window.addEventListener('resize', updateVisibility)
    const observer = new ResizeObserver(updateVisibility)
    observer.observe(document.body)
    return () => {
      window.removeEventListener('scroll', updateVisibility)
      window.removeEventListener('resize', updateVisibility)
      observer.disconnect()
    }
  }, [])

  return (
    <>
      <div aria-hidden="true" className="h-28 md:h-[76px]" />
      <footer
        aria-hidden={!visible}
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-ivory/15 bg-navy text-ivory/90 shadow-[0_-8px_24px_rgba(18,32,59,0.12)] transition-transform duration-300 ${
          visible ? 'visible translate-y-0' : 'invisible translate-y-full'
        }`}
      >
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
    </>
  )
}
