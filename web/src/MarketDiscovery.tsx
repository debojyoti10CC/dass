import { useState } from 'react'
import { formatCoordinate } from './chain'
import { dateTime, displayStatus, fromWad, usdc, utcTime } from './math'
import type { Market, RulesResult } from './types'

type Category = 'All markets' | 'Sports' | 'Crypto' | 'Other'
type Props = {
  markets: Market[]; rules: Record<string, RulesResult>; timestamp: bigint; loading: boolean
  visit: (market: Market) => void; explore: () => void; refresh: () => void
}

export { BrandMark } from './BrandMark'

function categoryOf(rules?: RulesResult): Category {
  const category = String(rules?.document?.category ?? '').toLowerCase()
  if (/football|sport/.test(category)) return 'Sports'
  if (/crypto/.test(category)) return 'Crypto'
  return 'Other'
}

function CategoryIcon({ category }: { category: Category }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="category-icon" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{category === 'Sports' ? <><circle cx="12" cy="12" r="9" /><path d="m12 7 4.5 3.3-1.7 5.2H9.2l-1.7-5.2L12 7Zm0 0V3m4.5 7.3 4-1.3m-5.7 7.5 2.5 3.2m-8.1-3.2-2.5 3.2m.8-9.4L3.5 9" /></> : category === 'Crypto' ? <><path d="M8 5v14m-2-2h8a3 3 0 0 0 0-6H8h5a3 3 0 0 0 0-6H6m4-2v2m4-2v2m-4 12v3m4-3v3" /></> : <path d="M3 18c5 0 4-12 9-12s4 12 9 12" />}</svg>
}

function CurvePreview({ market }: { market: Market }) {
  const sigma = fromWad(market.currentCurve.sigma), mean = fromWad(market.currentCurve.mean)
  const low = Math.max(fromWad(market.minOutcome), mean - 3.5 * sigma)
  const high = Math.min(fromWad(market.maxOutcome), mean + 3.5 * sigma)
  const points = Array.from({ length: 81 }, (_, index) => {
    const value = low + (high - low) * index / 80
    const y = 68 - Math.exp(-0.5 * ((value - mean) / sigma) ** 2) * 52
    return `${index ? 'L' : 'M'}${(index * 3).toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
  return <svg viewBox="0 0 240 80" className="market-preview" aria-hidden="true"><path d={`${points} L240,72 L0,72 Z`} className="mini-area" /><path d={points} className="mini-curve" /><path d="M0 72h240" className="mini-baseline" /></svg>
}

export function MarketStatus({ market, timestamp }: { market: Market; timestamp: bigint }) {
  const status = displayStatus(market, timestamp)
  return <span className={`badge market-status ${status === 'Open' ? 'status-open' : market.status === 1 ? 'status-resolved' : 'status-closed'}`}><i aria-hidden="true" />{status}</span>
}

export function MarketDiscovery({ markets, rules, timestamp, loading, visit, explore, refresh }: Props) {
  const [category, setCategory] = useState<Category>('All markets'), [query, setQuery] = useState(''), [state, setState] = useState('all')
  const open = markets.filter(market => displayStatus(market, timestamp) === 'Open')
  const escrow = markets.reduce((total, market) => total + market.deposited - market.paid, 0n)
  const filtered = markets.filter(market => {
    const document = rules[market.id.toString()]?.document
    return (category === 'All markets' || categoryOf(rules[market.id.toString()]) === category)
      && `${document?.question ?? ''} ${document?.category ?? ''} ${market.units} ${market.id}`.toLowerCase().includes(query.trim().toLowerCase())
      && (state === 'all' || (state === 'open' ? displayStatus(market, timestamp) === 'Open' : state === 'resolved' ? market.status === 1 : market.status === 2))
  }).sort((a, b) => Number(displayStatus(b, timestamp) === 'Open') - Number(displayStatus(a, timestamp) === 'Open') || Number(a.id - b.id))
  const count = (value: Category) => value === 'All markets' ? markets.length : markets.filter(market => categoryOf(rules[market.id.toString()]) === value).length
  return <>
    <section className="discovery-hero">
      <div className="hero-copy"><p className="eyebrow"><span className="eyebrow-line" />FORECAST THE REAL WORLD</p><h1>Every outcome.<br />A clearer <span>picture.</span></h1><p className="intro">From the final whistle to the next Bitcoin close. Put a number on what comes next — and show how certain you are.</p><div className="hero-actions"><a className="primary" href="#available-markets">Explore markets <span aria-hidden="true">↓</span></a><button className="text-button" onClick={explore}>How it works <span aria-hidden="true">↗</span></button></div><div className="hero-caption"><span>USDC settlement</span><span>Wallet-owned receipts</span><span>Onchain records</span></div></div>
      <div className="hero-visual" aria-label="How a distribution forecast works"><div className="visual-top"><span className="visual-label">A FORECAST, WITH PERSPECTIVE</span><span className="visual-symbol" aria-hidden="true">↗</span></div><svg viewBox="0 0 400 160" aria-hidden="true" className="hero-curve"><path d="M20 132H380M100 25v107M200 25v107M300 25v107" className="hero-grid" /><path d="M20 131c66 0 70-100 142-100s80 100 218 100" className="hero-curve-old" /><path d="M20 131c100 0 126-92 206-92s82 92 154 92v1H20Z" className="hero-curve-fill" /><path d="M20 131c100 0 126-92 206-92s82 92 154 92" className="hero-curve-new" /><circle cx="226" cy="39" r="5" fill="#fff" /></svg><div className="visual-terms"><div><span>Expected outcome</span><strong>The center.</strong></div><div><span>Uncertainty</span><strong>The whole range.</strong></div></div><p>Illustration of the mechanism · not market data</p><div className="visual-footer"><span>Beyond a yes or no.</span><button onClick={explore} aria-label="Explore distribution forecasts">→</button></div></div>
    </section>
    <dl className="market-overview" aria-label="Onchain market summary"><div><dt>Markets on this page</dt><dd>{loading ? '—' : markets.length}</dd></div><div><dt>Open on this page</dt><dd>{loading ? '—' : open.length}<span className="overview-dot" aria-hidden="true" /></dd></div><div><dt>Page escrow</dt><dd>{loading ? '—' : usdc(escrow)} <small>USDC</small></dd></div><div><dt>Settlement asset</dt><dd>USDC <span className="overview-asset" aria-hidden="true">$</span></dd></div></dl>
    <section className="discovery-section" id="available-markets" aria-label="Available markets"><div className="section-heading"><div><p className="eyebrow">FIND YOUR NEXT FORECAST</p><h2>Explore markets</h2></div><button className="text-button refresh-button" onClick={refresh} disabled={loading}><span aria-hidden="true">↻</span>{loading ? 'Updating…' : 'Refresh'}</button></div><div className="market-toolbar"><div className="category-tabs" role="group" aria-label="Market category">{(['All markets', 'Sports', 'Crypto'] as Category[]).map(value => <button key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}<span>{count(value)}</span></button>)}</div><div className="market-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg><input type="search" aria-label="Search markets" placeholder="Search markets" value={query} onChange={event => setQuery(event.target.value)} /></div><select aria-label="Market status" value={state} onChange={event => setState(event.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="resolved">Resolved</option><option value="cancelled">Cancelled</option></select></div><div className="market-results" role="status">{loading ? 'Reading confirmed onchain records…' : `${filtered.length} ${filtered.length === 1 ? 'market' : 'markets'}`}{!loading && <span>Forecasts submitted onchain · not external odds</span>}</div>
      {loading && !markets.length ? <div className="market-grid" aria-hidden="true">{[0, 1, 2].map(value => <div className="market-skeleton" key={value}><div /><div /><div /></div>)}</div> : filtered.length ? <div className="market-grid">{filtered.map(market => {
        const result = rules[market.id.toString()], document = result?.document, itemCategory = categoryOf(result)
        return <button key={market.id.toString()} className="market-card" onClick={() => visit(market)}><span className="market-card-top"><span className={`market-category category-${itemCategory.toLowerCase()}`}><CategoryIcon category={itemCategory} />{document?.category ? String(document.category) : 'Market'}</span><MarketStatus market={market} timestamp={timestamp} /></span><span className="market-card-title">{document?.question ?? `Market #${market.id} · rules ${result?.status ?? 'loading'}`}</span><span className="market-card-date" title={utcTime(market.closeAt)}>{market.status === 0 && timestamp < market.closeAt ? 'Closes' : 'Closed'} {dateTime(market.closeAt)}</span>{document?.kind === 'btc-five-minute-direction' ? <span className="market-card-forecast"><span><small>Choose a direction</small><strong className="number">↑ Up&nbsp;&nbsp; ↓ Down</strong><span className="forecast-units">BTC/USD · 5 minutes</span></span></span> : <><span className="market-card-forecast"><span><small>Expected outcome</small><strong className="number">{formatCoordinate(market.currentCurve.mean)}</strong><span className="forecast-units">{market.units}</span></span><span><small>Uncertainty σ</small><strong className="number">{formatCoordinate(market.currentCurve.sigma)}</strong></span></span><CurvePreview market={market} /></>}<span className="market-card-bottom"><span>Fixed collateral <strong>{usdc(market.backing)} USDC</strong></span><span className="card-arrow" aria-hidden="true">↗</span></span></button>
      })}</div> : <div className="empty-state card"><h3>{markets.length ? 'No markets match your search.' : 'No markets yet.'}</h3><p>{markets.length ? 'Try another keyword or category to find a forecast.' : 'Markets appear here when the operator creates them with committed rules and USDC backing.'}</p>{markets.length ? <button className="secondary" onClick={() => { setCategory('All markets'); setQuery(''); setState('all') }}>Clear filters</button> : <button className="primary" onClick={explore}>Explore the mechanism</button>}</div>}
    </section>
    <section className="mechanism-band"><div><p className="eyebrow">A DIFFERENT KIND OF MARKET</p><h2>A prediction is more<br />than a single number.</h2></div><div><p>Move the center to express your expected outcome. Change the width to express uncertainty. Each forecast creates a receipt you can claim after settlement.</p><a href="https://www.paradigm.xyz/writing/distribution-markets" target="_blank" rel="noreferrer">Built on the Paradigm mechanism <span aria-hidden="true">↗</span></a></div></section>
  </>
}
