import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, X, Route, Clock3, ClipboardList, MapPin, Users } from "lucide-react";
import { SectionHead, SectionNote } from "../../components/ui";
import { useMotion, EASE } from "../../lib/motion";
import { tierOf, TIER_META, type Confidence } from "../../data/engine";
import { AUDIT_CANDIDATES, AUDIT_CAPACITY, DEPOT, kmBetween, orderStops } from "../../data/roles";
import { cn } from "../../utils/cn";

const ONSITE_MIN = 18;
const SHIFT_START_MIN = 6 * 60 + 30; // crews roll out at 06:30
const URBAN_KMH = 27;

const fmtTime = (mins: number) => {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

function MiniBadge({ c }: { c: Confidence }) {
  const s: Record<Confidence, string> = {
    High: "border-navy/25 bg-navy/5 text-navy",
    Medium: "border-teal/30 bg-teal/10 text-teal",
    Low: "border-amber/40 bg-amber/15 text-[#8a5510]",
  };
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", s[c])} title={`${c} confidence`}>
      {c}
    </span>
  );
}

const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

/**
 * +1 feature for Road Authorities — turn the ranked emerging-risk list into a
 * tomorrow-morning crew route. All quantities derived from the embedded cell
 * snapshot; route leg times are simulated and labelled as such.
 */
export default function RoadAuthority() {
  const { reduced } = useMotion();
  const [selected, setSelected] = useState<string[]>([]);

  const stops = useMemo(() => orderStops(selected.map((id) => AUDIT_CANDIDATES.find((c) => c.id === id)!)), [selected]);

  const plan = useMemo(() => {
    let prev: { lat: number; lng: number } = DEPOT;
    let clock = SHIFT_START_MIN;
    let totalKm = 0;
    let totalDrive = 0;
    const legs = stops.map((c) => {
      const km = kmBetween(prev, c);
      const drive = (km / URBAN_KMH) * 60;
      const arrive = clock + drive;
      const leg = { cell: c, km, drive, arrive, depart: arrive + ONSITE_MIN };
      clock = leg.depart;
      prev = c;
      totalKm += km;
      totalDrive += drive;
      return leg;
    });
    return { legs, totalKm, totalDrive, totalMin: totalDrive + stops.length * ONSITE_MIN };
  }, [stops]);

  const full = selected.length >= AUDIT_CAPACITY;

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < AUDIT_CAPACITY ? [...s, id] : s));

  return (
    <section id="workspace" className="scroll-mt-20 bg-white">
      <div className="mx-auto w-full max-w-[1320px] px-5 py-24 lg:px-8 lg:py-32">
        <SectionHead
          kicker="Signed in · Road Authority — your +1 feature"
          title="Audit Dispatch Queue."
          lede="The ranked map becomes tomorrow's route. Pick up to six stops; the board orders them from the downtown depot and totals the shift. Simulated route times — human dispatchers confirm."
        />

        <div className="mt-14 grid items-start gap-6 lg:grid-cols-[1.05fr_1fr]">
          {/* candidates */}
          <div className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold tracking-[0.16em] text-ink/50 uppercase">
                Ranked candidates · emerging & elevated cells
              </p>
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-semibold tabular-nums",
                  full ? "bg-brick/10 text-brick" : "bg-navy/5 text-navy",
                )}
              >
                {selected.length} / {AUDIT_CAPACITY} stops
              </span>
            </div>
            <ul className="mt-4 grid gap-2">
              {AUDIT_CANDIDATES.map((c, i) => {
                const tier = TIER_META[tierOf(c)];
                const on = selected.includes(c.id);
                return (
                  <motion.li
                    key={c.id}
                    initial={reduced ? { opacity: 0 } : { opacity: 0, x: -14 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, margin: "-8% 0px" }}
                    transition={{ duration: 0.45, delay: i * 0.04, ease: EASE.out }}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-3.5 py-2.5 transition-colors",
                      on ? "border-brass/60 bg-brass/8" : "border-navy/10 bg-white hover:border-navy/25",
                    )}
                  >
                    <span className="w-6 text-right font-serif text-[13px] text-ink/40 tabular-nums">{i + 1}</span>
                    <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: tier.hex }} title={tier.label} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12px] text-navy">{c.id}</span>
                      <span className="mt-0.5 block text-[11px] text-ink/50">
                        {c.pastCrashes} past crashes · {tier.label.split(" — ")[0].toLowerCase()}
                      </span>
                    </span>
                    <span className="hidden font-semibold text-navy tabular-nums sm:block">{(c.baseline * 100).toFixed(1)}%</span>
                    <MiniBadge c={c.confidence} />
                    <button
                      onClick={() => toggle(c.id)}
                      disabled={!on && full}
                      aria-pressed={on}
                      aria-label={on ? `Remove cell ${c.id} from the queue` : `Add cell ${c.id} to the queue`}
                      className={cn(
                        "grid h-8 w-8 flex-none place-items-center rounded-lg border transition-colors",
                        on
                          ? "border-brick/40 bg-brick/10 text-brick hover:bg-brick/20"
                          : full
                            ? "cursor-not-allowed border-navy/10 text-ink/25"
                            : "border-navy/20 text-navy hover:border-brass hover:bg-brass/10",
                      )}
                    >
                      {on ? <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" /> : <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
                    </button>
                  </motion.li>
                );
              })}
            </ul>
            {full && (
              <p className="mt-3 text-[12px] font-medium text-brick">Crew full — remove a stop to swap another in.</p>
            )}
          </div>

          {/* dispatch board */}
          <div className="grid content-start gap-5">
            <div className="card p-5">
              <p className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.16em] text-ink/50 uppercase">
                <Route className="h-4 w-4 text-brass" strokeWidth={1.8} aria-hidden="true" />
                Dispatch board · {today}
              </p>

              <div className="mt-4 min-h-[140px]">
                {plan.legs.length === 0 ? (
                  <div className="grid h-[140px] place-items-center rounded-lg border border-dashed border-navy/15 text-center">
                    <p className="max-w-[30ch] text-[13px] text-ink/50">
                      Add stops from the ranked list — the board drafts a route and a crew brief.
                    </p>
                  </div>
                ) : (
                  <ol className="relative grid gap-0">
                    <AnimatePresence initial={false}>
                      {plan.legs.map((leg, i) => (
                        <motion.li
                          key={leg.cell.id}
                          layout
                          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.97 }}
                          transition={{ duration: 0.4, ease: EASE.out }}
                          className="relative grid grid-cols-[26px_1fr_auto] items-start gap-3 pb-4"
                        >
                          {i < plan.legs.length - 1 && (
                            <span className="absolute top-6 left-[12px] h-[calc(100%-14px)] w-px bg-navy/12" aria-hidden="true" />
                          )}
                          <span className="grid h-[26px] w-[26px] place-items-center rounded-full border border-brass/60 bg-brass/12 font-serif text-[12px] font-semibold text-[#6d4d17]">
                            {i + 1}
                          </span>
                          <span>
                            <span className="block font-mono text-[12.5px] text-navy">{leg.cell.id}</span>
                            <span className="mt-0.5 block text-[11.5px] text-ink/55">
                              +{leg.km.toFixed(1)} km from previous · ~{Math.round(leg.drive)} min drive · {(leg.cell.baseline * 100).toFixed(1)}%
                              baseline
                            </span>
                          </span>
                          <span className="text-right text-[11.5px] leading-tight font-medium text-ink/65 tabular-nums">
                            arrive ≈ {fmtTime(leg.arrive)}
                            <span className="block text-ink/40">leave {fmtTime(leg.depart)}</span>
                          </span>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ol>
                )}
              </div>

              {plan.legs.length > 0 && (
                <div className="mt-1 grid grid-cols-3 gap-3 border-t border-navy/8 pt-4 text-center">
                  <div>
                    <p className="font-serif text-[20px] font-semibold text-navy tabular-nums">{plan.totalKm.toFixed(1)}</p>
                    <p className="text-[10.5px] tracking-wide text-ink/50 uppercase">route km</p>
                  </div>
                  <div>
                    <p className="font-serif text-[20px] font-semibold text-navy tabular-nums">
                      {Math.floor(plan.totalMin / 60)}h {String(Math.round(plan.totalMin % 60)).padStart(2, "0")}m
                    </p>
                    <p className="text-[10.5px] tracking-wide text-ink/50 uppercase">est. shift</p>
                  </div>
                  <div>
                    <p className="font-serif text-[20px] font-semibold text-navy tabular-nums">{ONSITE_MIN}m</p>
                    <p className="text-[10.5px] tracking-wide text-ink/50 uppercase">per stop</p>
                  </div>
                </div>
              )}
            </div>

            {/* crew brief */}
            <div className="rounded-xl border border-navy/12 bg-navy p-5 text-ivory">
              <p className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.16em] text-ivory/50 uppercase">
                <ClipboardList className="h-4 w-4 text-brass-soft" strokeWidth={1.8} aria-hidden="true" />
                Crew brief · draft
              </p>
              {plan.legs.length === 0 ? (
                <p className="mt-3 text-[13px] text-ivory/55">The brief fills itself as you build the queue.</p>
              ) : (
                <div className="mt-3 font-mono text-[12px] leading-[1.9] text-ivory/85">
                  <p>
                    <Users className="mr-1 inline h-3.5 w-3.5 text-brass-soft" aria-hidden="true" /> Crew A · depart{" "}
                    {DEPOT.label} {fmtTime(SHIFT_START_MIN)}
                  </p>
                  {plan.legs.map((leg, i) => (
                    <p key={leg.cell.id}>
                      #{i + 1} <MapPin className="mr-1 inline h-3 w-3 text-brass-soft" aria-hidden="true" />
                      {leg.cell.id} · {(leg.cell.baseline * 100).toFixed(1)}% · on site ≈ {fmtTime(leg.arrive)}
                    </p>
                  ))}
                </div>
              )}
              <p className="mt-4 flex items-start gap-2 border-t border-ivory/12 pt-3 text-[11.5px] leading-snug text-ivory/50">
                <Clock3 className="mt-0.5 h-3.5 w-3.5 flex-none" strokeWidth={1.7} aria-hidden="true" />
                Simulated route times from straight-line distances — human dispatchers confirm the final order on the
                street network.
              </p>
            </div>
          </div>
        </div>

        <SectionNote />
      </div>
    </section>
  );
}
