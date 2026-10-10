import { useId } from 'react'
import { density, fromWad, previewPnL, signed } from './math'
import type { Curve, Market } from './types'

export function Charts({ market, proposed, scenario, setScenario }: { market: Market; proposed: Curve; scenario: number; setScenario: (value: number) => void }) {
  const id = useId().replace(/:/g, ''), old = market.currentCurve
  const preferredLow = Math.max(fromWad(market.minOutcome), Math.min(fromWad(old.mean) - 4 * fromWad(old.sigma), fromWad(proposed.mean) - 4 * fromWad(proposed.sigma)))
  const preferredHigh = Math.min(fromWad(market.maxOutcome), Math.max(fromWad(old.mean) + 4 * fromWad(old.sigma), fromWad(proposed.mean) + 4 * fromWad(proposed.sigma)))
  const low = preferredLow < preferredHigh ? preferredLow : fromWad(market.minOutcome)
  const high = preferredLow < preferredHigh ? preferredHigh : fromWad(market.maxOutcome)
  const maxDensity = Math.max(density(old, fromWad(old.mean)), density(proposed, fromWad(proposed.mean))) * 1.15
  const pnl = previewPnL(market, proposed, scenario), deposit = Number(market.backing) / 1e6
  const width = 760, height = 256, left = 68, right = 20, top = 18, bottom = 48
  const x = (value: number) => left + (value - low) / (high - low) * (width - left - right)
  const samples = Array.from({ length: 241 }, (_, index) => low + (high - low) * index / 240)
  const draw = (fn: (value: number) => number, y: (value: number) => number) => samples.map((value, index) => `${index ? 'L' : 'M'}${x(value).toFixed(2)},${y(fn(value)).toFixed(2)}`).join(' ')
  const panel = (isPnL: boolean) => {
    const y = (value: number) => isPnL ? top + (deposit - value) / (2 * deposit) * (height - top - bottom) : top + (maxDensity - value) / maxDensity * (height - top - bottom)
    const yTicks = isPnL ? [-deposit, 0, deposit] : [0, maxDensity / 2, maxDensity]
    return <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-${isPnL ? 'pnl' : 'density'}`} onPointerMove={event => {
      if (event.buttons !== 1 && event.pointerType === 'touch') return
      const rect = event.currentTarget.getBoundingClientRect(), local = (event.clientX - rect.left) / rect.width * width
      setScenario(Math.max(low, Math.min(high, low + (local - left) / (width - left - right) * (high - low))))
    }}>
      <title id={`${id}-${isPnL ? 'pnl' : 'density'}`}>{isPnL ? `Illustrative receipt P&L. At outcome ${scenario.toFixed(2)}, ${signed(pnl)} USDC.` : `Probability density. Current mean ${fromWad(old.mean)} and uncertainty ${fromWad(old.sigma)}. Proposed mean ${fromWad(proposed.mean)} and uncertainty ${fromWad(proposed.sigma)}.`}</title>
      {!isPnL && <path d={`${draw(value => density(proposed, value), y)} L${x(high)},${y(0)} L${x(low)},${y(0)} Z`} className="density-area" />}
      {yTicks.map(value => <g key={value}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className={value === 0 && isPnL ? 'zero-line' : 'grid-line'} /><text x={left - 12} y={y(value) + 5} textAnchor="end">{isPnL ? `${value > 0 ? '+' : ''}${value.toFixed(0)}` : value.toFixed(3)}</text></g>)}
      {Array.from({ length: 5 }, (_, index) => low + (high - low) * index / 4).map(value => <g key={value}><line x1={x(value)} x2={x(value)} y1={top} y2={height - bottom} className="grid-line vertical" /><text x={x(value)} y={height - bottom + 24} textAnchor="middle">{value.toFixed(1)}</text></g>)}
      {isPnL ? <path d={draw(value => previewPnL(market, proposed, value), y)} className="pnl-line" /> : <><path d={draw(value => density(old, value), y)} className="current-line" /><path d={draw(value => density(proposed, value), y)} className="proposed-line" /></>}
      <line x1={x(Math.max(low, Math.min(high, scenario)))} x2={x(Math.max(low, Math.min(high, scenario)))} y1={top} y2={height - bottom} className="cursor-line" />
      {scenario >= low && scenario <= high && <circle cx={x(scenario)} cy={y(isPnL ? pnl : density(proposed, scenario))} r="4" className="cursor-dot" />}
      <text x={(left + width - right) / 2} y={height - 3} textAnchor="middle">Outcome · normalized {market.units}</text>
    </svg>
  }
  return <div className="chart-stack">
    <section className="plot-card"><div className="plot-heading"><div><p className="eyebrow">THE FORECAST</p><h2>See the uncertainty.</h2></div><span className="axis-unit">Probability density</span></div><div className="legend"><span><i className="dashed" />Current forecast</span><span><i />Your proposal</span></div>{panel(false)}</section>
    <section className="plot-card"><div className="plot-heading"><div><p className="eyebrow">YOUR RECEIPT</p><h2>See the possible P&amp;L.</h2></div><span className="axis-unit">USDC · fees excluded</span></div>{panel(true)}<div className="scenario-readout"><label htmlFor={`${id}-scenario`}>Scenario outcome<input id={`${id}-scenario`} type="number" value={Number(scenario.toFixed(4))} step="0.1" min={fromWad(market.minOutcome)} max={fromWad(market.maxOutcome)} onChange={event => { if (event.target.value !== '' && Number.isFinite(Number(event.target.value))) setScenario(Math.max(fromWad(market.minOutcome), Math.min(fromWad(market.maxOutcome), Number(event.target.value)))) }} /></label><div><span>Illustrative P&amp;L</span><strong className={pnl >= 0 ? 'gain' : 'loss'}>{signed(pnl)} USDC</strong></div><div><span>Settlement payout</span><strong>≈ {(deposit + pnl).toFixed(4)} USDC</strong></div></div><p className="fine-print">Move over either plot or use the scenario input to inspect one possible outcome. The chart window omits tails; outcomes beyond it can still settle. Charts use an approximate analytic evaluator. Exact settlement uses onchain integer evaluation.</p></section>
  </div>
}
