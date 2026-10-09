import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ShapRow } from '../../lib/api'
import { MAP_PALETTE, fmtNum, prettyModelFeature } from '../../lib/format'

export function ShapChart({ rows }: { rows: ShapRow[] }) {
  const data = rows.map((r) => ({ ...r, label: prettyModelFeature(r.feature) }))
  return (
    <figure>
      <div style={{ height: Math.max(170, data.length * 38 + 36) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="#12203B22" />
            <XAxis type="number" tickFormatter={(v: number) => v.toFixed(2)} tick={{ fontSize: 12 }} />
            <YAxis type="category" dataKey="label" width={128} tick={{ fontSize: 12.5 }} interval={0} />
            <ReferenceLine x={0} stroke={MAP_PALETTE.navy} />
            <Tooltip
              cursor={{ fill: '#12203B0D' }}
              content={({ active, payload }) => {
                const item = payload?.[0]?.payload as (ShapRow & { label: string }) | undefined
                if (!active || !item) return null
                return (
                  <div className="rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm shadow-card">
                    <p className="font-semibold">{item.label}</p>
                    <p>Value in this cell: {typeof item.feature_value === 'number' ? fmtNum(item.feature_value, 2) : (item.feature_value ?? '—')}</p>
                    <p>
                      {item.shap_value >= 0 ? 'Pushes score up' : 'Pushes score down'} ({fmtNum(item.shap_value, 3)})
                    </p>
                  </div>
                )
              }}
            />
            <Bar dataKey="shap_value" radius={3} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.feature} fill={d.shap_value >= 0 ? MAP_PALETTE.brick : MAP_PALETTE.teal} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-navy/75">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm bg-brick" /> Red pushes the score up
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm bg-teal" /> Teal pushes it down
        </span>
      </figcaption>
      <ul className="sr-only">
        {data.map((d) => (
          <li key={d.feature}>
            {d.label}: {d.shap_value >= 0 ? 'pushes score up' : 'pushes score down'} by {fmtNum(Math.abs(d.shap_value), 3)}
          </li>
        ))}
      </ul>
    </figure>
  )
}
