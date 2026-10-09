import { useCallback, useEffect, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { MotionProvider, useMotion } from "./lib/motion";
import { setLenis } from "./lib/scroll";
import Preloader from "./components/Preloader";
import Nav from "./components/Nav";
import Hero from "./sections/Hero";
import Problem from "./sections/Problem";
import HowItWorks from "./sections/HowItWorks";
import LivePreview from "./sections/LivePreview";
import Evidence from "./sections/Evidence";
import Impact from "./sections/Impact";
import Limits from "./sections/Limits";
import FinalCTA from "./sections/FinalCTA";
import Footer from "./sections/Footer";

gsap.registerPlugin(ScrollTrigger);

function Shell() {
  const { reduced } = useMotion();
  const [loaded, setLoaded] = useState(false);

  /* Lenis smooth scroll */
  useEffect(() => {
    if (reduced) {
      setLenis(null);
      return;
    }
    const lenis = new Lenis({ duration: 1.12, smoothWheel: true });
    setLenis(lenis);
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      setLenis(null);
    };
  }, [reduced]);

  const handleLoaded = useCallback(() => {
    setLoaded(true);
    window.setTimeout(() => ScrollTrigger.refresh(), 80);
  }, []);

  return (
    <>
      <Preloader onDone={handleLoaded} />
      <Nav visible={loaded} />
      <main>
        <Hero started={loaded} />
        <Problem />
        <HowItWorks />
        <LivePreview />
        <Evidence />
        <Impact />
        <Limits />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}

export default function App() {
  return (
    <MotionProvider>
      <Shell />
    </MotionProvider>
  );
}
