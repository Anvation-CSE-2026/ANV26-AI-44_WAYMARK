import { Link } from 'react-router-dom'
import { LogoMark } from '../components/Logo'
import { Card, PageContainer, PageHeader } from '../components/ui'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-6">
      <h2 className="text-2xl font-bold">{title}</h2>
      <div className="mt-3 space-y-3 text-lg leading-relaxed text-navy/85">{children}</div>
    </Card>
  )
}

export default function AboutPage() {
  return (
    <PageContainer>
      <PageHeader eyebrow="About" title="Explainable road risk, cell by cell">
        Waymark helps road-safety teams decide where a proactive site audit may be worth the time, including places with
        very little crash history.
      </PageHeader>

      <div className="space-y-6">
        <Section title="The problem">
          <p>
            Most blackspot lists are reactive: a location appears only after crashes pile up. In areas with sparse
            history, that approach has little to say. Waymark asks a different question: which cells look similar to past
            blackspots, even though their own record is short?
          </p>
        </Section>

        <Section title="How it works">
          <ul className="list-disc space-y-2 pl-6">
            <li>Houston is divided into hexagonal H3 cells, so every location is compared on equal terms.</li>
            <li>A gradient boosting model scores each cell from road features, conditions and past crash patterns.</li>
            <li>SHAP values show which factors push each cell's score up or down, so reviewers can see why.</li>
            <li>
              Each cell is compared with cells that have a similar crash history, which gives the "riskier than X% of
              cells with similar history" headline.
            </li>
            <li>
              The model was trained on 2020–21 and tested on 2021–22, with checks that no feature uses data after its
              cut-off year.
            </li>
          </ul>
        </Section>

        <Section title="How to read the map">
          <p>
            Teal markers are the top-scoring cells overall. Red, amber and yellow markers are emerging-risk cells, shaded
            by how they rank against cells with similar history. Select a cell for its confidence badge, factor chart and
            suggested actions. The what-if panel re-runs the stored model under night, rain or low-visibility conditions.
            It is a scenario simulation, not a live forecast.
          </p>
        </Section>

        <Section title="Confidence and wording">
          <p>
            Every cell carries a confidence badge. Emerging-risk cells are Low confidence by design, because they have
            little history to learn from. For that reason Waymark speaks of elevated risk and recommends a site audit. It
            never says that a crash will happen.
          </p>
        </Section>

        <Section title="Limits">
          <p>
            Results come from one city and one main backtest. Open the <Link className="font-semibold text-teal underline" to="/evidence">Evidence</Link> and{' '}
            <Link className="font-semibold text-teal underline" to="/data-quality">Data quality</Link> pages for the numbers,
            the robustness checks and every warning. Waymark is decision support only, and human experts decide.
          </p>
        </Section>

        <Section title="Data credit">
          <p>
            Crash records come from the US Accidents dataset (2016–2023), a countrywide traffic accident dataset created by
            Sobhan Moosavi, Mohammad Hossein Samavatian, Srinivasan Parthasarathy and Rajiv Ramnath. Please cite their
            work when you reuse the data.
          </p>
        </Section>

        <div className="flex items-center gap-3 pt-2 text-navy/70">
          <LogoMark size={28} />
          <p className="font-serif text-lg">WAYMARK</p>
        </div>
      </div>
    </PageContainer>
  )
}
