import { useCallback, useEffect, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { MotionProvider, useMotion } from './lib/motion'
import { setLenis } from './lib/scroll'
import Preloader from './components/Preloader'
import Nav from './components/Nav'
import Hero from './sections/Hero'
import Problem from './sections/Problem'
import HowItWorks from './sections/HowItWorks'
import About from './sections/About'
import Footer from './sections/Footer'

gsap.registerPlugin(ScrollTrigger)

function LandingContent() {
  const { reduced } = useMotion()
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (reduced) {
      setLenis(null)
      return
    }
    const lenis = new Lenis({ duration: 1.12, smoothWheel: true })
    setLenis(lenis)
    lenis.on('scroll', () => {
      ScrollTrigger.update()
      window.dispatchEvent(new Event('waymark:scroll'))
    })
    const tick = (time: number) => lenis.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    return () => {
      gsap.ticker.remove(tick)
      lenis.destroy()
      setLenis(null)
    }
  }, [reduced])

  const handleLoaded = useCallback(() => {
    setLoaded(true)
    window.setTimeout(() => ScrollTrigger.refresh(), 80)
  }, [])

  return (
    <div className="landing-page">
      <a className="landing-skip-link" href="#main">Skip to content</a>
      <Preloader onDone={handleLoaded} />
      <Nav visible={loaded} />
      <main id="main">
        <Hero started={loaded} />
        <Problem />
        <HowItWorks />
        <About />
      </main>
      <Footer />
    </div>
  )
}

export default function LandingPage() {
  return <MotionProvider><LandingContent /></MotionProvider>
}
