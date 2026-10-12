import { useEffect, useRef, useState } from 'react'
import { BrandMark } from './BrandMark'
import { density, evaluatePreview } from './math'
import './landing.css'

const source = 'https://github.com/debojyoti10CC/dass/blob/main/'
const oldCurve = { mean: 2400000000000000000n, sigma: 1200000000000000000n }
const newCurve = { mean: 3600000000000000000n, sigma: 900000000000000000n }
const backing = 1000000n, norm = 800000000000000000n, outcome = 3.6
const oldValue = evaluatePreview(oldCurve, outcome, norm, backing)
const newValue = evaluatePreview(newCurve, outcome, norm, backing)
const difference = Math.round((newValue - oldValue) * 1e6) / 1e6
const money = (value: number) => value.toFixed(6)
const steps = [
  { id: 'forecast', title: 'Start with a range of possibilities.', label: 'The forecast', body: 'A number tells only half the story. The center of a Gaussian curve expresses the expected outcome. Its width expresses uncertainty. The sponsor funds the first forecast and fixes the market’s rules.', note: 'Mean = expected outcome. Standard deviation = uncertainty.' },
  { id: 'change', title: 'Change the curve. Express your view.', label: 'Your forecast', body: 'Think the outcome will be higher? Move the center. Feel more certain? Narrow the curve within the market’s limits. Your forecast replaces the current one, and your receipt remembers both.', note: 'This example moves the mean from 2.4 to 3.6 and uncertainty from 1.2 to 0.9.' },
  { id: 'collateral', title: 'One deposit. A difference to own.', label: 'Your receipt', body: 'Each trade deposits the market’s fixed collateral, b. Your position earns the new curve’s value minus the old curve’s value at settlement. Here the graph switches from probability density to the curve values used for payouts.', note: 'Illustrative backing: 1 USDC per participant. Collateral is returned within the payout; gas is separate.' },
  { id: 'settlement', title: 'One outcome settles the difference.', label: 'The settlement', body: 'After trading closes, the trusted resolver reports the final outcome. Follow the vertical line: subtract the old curve’s value from the new one, then add your deposit. The receipt owner claims that amount.', note: 'Illustrative outcome: 3.6 units. Actual settlement uses the contract’s integer evaluator.' },
]

function ForecastGraph({ stage }: { stage: number }) {
  const payout = stage >= 2
  const scale = payout ? 1 : .5
  const x = (value: number) => 42 + (value + 1) / 8 * 476
  const y = (value: number) => 225 - value / scale * 170
  const points = (curve: typeof oldCurve) => Array.from({ length: 161 }, (_, i) => {
    const value = -1 + i / 20
    return `${i ? 'L' : 'M'}${x(value).toFixed(2)},${y(payout ? evaluatePreview(curve, value, norm, backing) : density(curve, value)).toFixed(2)}`
  }).join(' ')
  const current = points(oldCurve), proposed = points(newCurve)
  const showNew = stage > 0
  return <svg className="landing-graph" viewBox="0 0 560 275" role="img" aria-label={payout ? `Illustrative settlement curve values. At outcome 3.6, old value ${money(oldValue)} USDC and new value ${money(newValue)} USDC.` : 'Illustrative Gaussian forecast. The proposed curve moves right and becomes narrower, expressing a higher expected outcome with less uncertainty.'}>
    {[0, .5, 1].map(tick => <g key={tick}><path className="landing-grid" d={`M42 ${y(tick * scale)}H518`} /><text className="graph-tick" x="30" y={y(tick * scale) + 4} textAnchor="end">{tick * scale}</text></g>)}
    <path className="landing-grid" d="M42 55V225 M518 55V225" />
    <path className="landing-area" d={`${showNew ? proposed : current} L518,225 L42,225 Z`} />
    <path className={showNew ? 'landing-old' : 'landing-new'} d={current} />
    {showNew && <path className="landing-new" d={proposed} />}
    {stage === 3 && <g className="settlement-marker"><path className="landing-outcome" d={`M${x(outcome)} 40V225`} /><path className="landing-difference" d={`M${x(outcome)} ${y(oldValue)}V${y(newValue)}`} /><circle className="old-point" cx={x(outcome)} cy={y(oldValue)} r="5" /><circle className="new-point" cx={x(outcome)} cy={y(newValue)} r="5" /><text x={x(outcome) + 10} y="46" className="graph-caption">Outcome 3.6</text><text x={x(outcome) + 12} y={y(newValue) - 8} className="graph-caption endpoint-label">New {money(newValue)}</text><text x={x(outcome) + 12} y={y(oldValue) + 18} className="graph-caption endpoint-label">Old {money(oldValue)}</text></g>}
    {[0, 2, 4, 6].map(tick => <text key={tick} className="graph-tick" x={x(tick)} y="246" textAnchor="middle">{tick}</text>)}
    <text className="graph-tick" x="280" y="268" textAnchor="middle">Outcome · units</text>
  </svg>
}

export function LandingPage() {
  const [active, setActive] = useState(0)
  const chapterRefs = useRef<(HTMLElement | null)[]>([])
  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 760px)').matches
    const topMargin = window.innerHeight * (mobile ? .65 : .4)
    const bottomMargin = window.innerHeight * (mobile ? .15 : .4)
    const focusY = window.innerHeight * (mobile ? .75 : .5)
    const observer = new IntersectionObserver(() => {
      const chapter = chapterRefs.current.find(node => {
        const bounds = node?.getBoundingClientRect()
        return bounds && bounds.top <= focusY && bounds.bottom >= focusY
      })
      if (chapter) setActive(Number(chapter.dataset.step))
    }, { rootMargin: `-${topMargin}px 0px -${bottomMargin}px 0px`, threshold: 0 })
    chapterRefs.current.forEach(chapter => { if (chapter) observer.observe(chapter) })
    const reveals = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('is-revealed'); reveals.unobserve(entry.target) }
    }, { threshold: .12 })
    document.querySelectorAll('.landing .landing-section-heading, .landing .settlement-ledger, .landing .inside-intro, .landing .landing-principles').forEach(element => {
      element.classList.add('landing-reveal')
      reveals.observe(element)
    })
    return () => { observer.disconnect(); reveals.disconnect() }
  }, [])

  return <div className="landing">
    <a href="#landing-main" className="skip-link">Skip to content</a>
    <div className="landing-masthead">
    <header className="landing-header">
      <a className="wordmark" href="/" aria-label="Dass home"><BrandMark /><span>Dass</span></a>
      <nav aria-label="Main navigation">
        <div className="landing-nav-menu"><button type="button">Products</button><div className="landing-nav-menu-popover"><a href="?view=markets">Prediction page</a></div></div>
        <div className="landing-nav-menu"><button type="button">Resources</button><div className="landing-nav-menu-popover"><span>Documents <small>Coming soon</small></span><span>Whitepaper <small>Coming soon</small></span></div></div>
      </nav>
      <a className="landing-button" href="?view=markets">Join the waitlist <span aria-hidden="true">↗</span></a>
    </header>
    </div>

    <main id="landing-main" className="landing-main" tabIndex={-1}>
      <section className="landing-visual" aria-label="dass: distributed prediction market on Arc" tabIndex={0}>
        <img className="landing-banner" src="/landscape.png" alt="A softly painted green landscape beneath a pale, misty sky." width="1200" height="850" fetchPriority="high" />
        <div className="landing-visual-shade" aria-hidden="true" />
        <div className="landing-visual-grid" aria-hidden="true" />
        <h1 className="landing-visual-title"><span>DISTRIBUTED</span><span>PREDICTION MARKET</span><span>ON ARC</span></h1>
      </section>
      <section className="landing-thesis" aria-labelledby="thesis-title">
        <h2 id="thesis-title">You change the forecast.<br />The outcome decides its value.<br /><span>The difference is yours.</span></h2>
        <div className="landing-thesis-graph"><ForecastGraph stage={1} /><div className="thesis-graph-legend"><span><i className="legend-old" />Current · μ 2.4, σ 1.2</span><span><i />Your view · μ 3.6, σ 0.9</span></div></div>
      </section>

      <section id="how-it-works" className="landing-story" aria-labelledby="story-title">
        <div className="landing-section-heading"><p className="landing-kicker">✳ FOLLOW THE CURVE</p><h2 id="story-title">From a forecast<br />to a settled receipt.</h2><p>Scroll through one illustrative trade.</p></div>
        <div className="story-layout">
          <div className="story-visual">
            <div className="story-chart-panel" data-stage={active}>
              <div className="story-chart-heading"><span>{steps[active].label}</span><span className="landing-micro">0{active + 1} / 04</span></div>
              <ForecastGraph stage={active} />
              <div className="story-legend"><span><i className={active ? 'legend-old' : 'legend-new'} />{active ? 'Old curve' : 'Current curve'}</span>{active > 0 && <span><i className="legend-new" />New curve</span>}<span>{active >= 2 ? 'Payout values' : 'Forecast density'}</span></div>
              <div className="story-readout" aria-live="polite" aria-atomic="true">
                {active < 2 ? <><div><span>Expected outcome</span><strong>{active ? '3.6' : '2.4'} <small>units</small></strong></div><div><span>Uncertainty · σ</span><strong>{active ? '0.9' : '1.2'}</strong></div></> : active === 2 ? <><div><span>Fixed deposit · b</span><strong>1 <small>USDC</small></strong></div><div><span>Your position</span><strong className="readout-formula">F(new) − F(old)</strong></div></> : <><div><span>Your payout · deposit + difference</span><strong>{money(1 + difference)} <small>USDC</small></strong></div><div><span>P&amp;L · gas excluded</span><strong className="readout-profit">+{money(difference)}</strong></div></>}
              </div>
              <p className="story-disclaimer">Illustration only. Density is not the probability of an exact outcome. Display math is approximate.</p>
            </div>
            <nav className="story-step-links" aria-label="Forecast chapters">{steps.map((step, index) => <a key={step.id} href={`#${step.id}`} aria-current={active === index ? 'step' : undefined} onClick={() => setActive(index)}><span>0{index + 1}</span><span>{step.label}</span></a>)}</nav>
          </div>
          <div className="story-chapters">{steps.map((step, index) => <article id={step.id} key={step.id} data-step={index} ref={node => { chapterRefs.current[index] = node }} className={`story-chapter${active === index ? ' is-active' : ''}`}><span className="chapter-number">0{index + 1}</span><h3>{step.title}</h3><p>{step.body}</p><p className="chapter-note">{step.note}</p></article>)}</div>
        </div>
      </section>

      <section className="landing-accounting" aria-labelledby="accounting-title">
        <div><p className="landing-kicker">✳ WHERE THE MONEY GOES</p><h2 id="accounting-title">Every difference<br />has another side.</h2><p>The sponsor funds the initial curve and keeps its value plus the final residual. In this one-trade example, the trader and sponsor each deposit 1 USDC.</p><p>All curve differences cancel when added together. The contract pays exactly the tracked deposits, with no extra money created.</p></div>
        <div className="settlement-ledger">
          <div className="ledger-heading"><span>AT OUTCOME 3.6</span><span>ILLUSTRATIVE · USDC</span></div>
          <div className="ledger-calculation"><span>New curve value</span><strong>{money(newValue)}</strong></div><div className="ledger-calculation"><span>− Old curve value</span><strong>{money(oldValue)}</strong></div>
          <div className="ledger-difference"><span>= Trader’s difference</span><strong>+{money(difference)}</strong></div>
          <div className="ledger-payout"><span>Trader receives<small>1 + F(new) − F(old)</small></span><strong>{money(1 + difference)}</strong></div>
          <div className="ledger-payout"><span>Sponsor receives<small>1 + F(initial) − F(final)</small></span><strong>{money(1 - difference)}</strong></div>
          <div className="ledger-total"><span>Total paid = total deposited</span><strong>2.000000</strong></div>
          <p>Each receipt stays open until settlement or cancellation. A later trade creates another receipt; it does not close this one.</p>
        </div>
      </section>

      <section className="landing-resolution" aria-labelledby="resolution-title">
        <div className="landing-section-heading"><p className="landing-kicker">✳ THE RULES COME FIRST</p><h2 id="resolution-title">A deadline. An observation.<br />A path back to your funds.</h2></div>
        <ol className="resolution-timeline"><li><span className="timeline-dot" /><span className="landing-micro">BEFORE CLOSE</span><h3>Trade the forecast</h3><p>The operator fixes the source, units, resolver, backing and deadlines at creation. Successful trades store individual receipts.</p></li><li><span className="timeline-dot" /><span className="landing-micro">AFTER CLOSE · BEFORE EXPIRY</span><h3>Report the outcome</h3><p>Only the market’s trusted resolver can submit a valid outcome and evidence hash. Owners then claim their payouts.</p></li><li><span className="timeline-dot" /><span className="landing-micro">AT EXPIRY · IF UNRESOLVED</span><h3>Cancel and refund</h3><p>Anyone can cancel an unresolved market. Traders and sponsor can claim their original deposits. Gas fees are separate.</p></li></ol>
        <p className="resolution-trust"><strong>The trust boundary is explicit.</strong> Evidence hashes make records inspectable. They do not prevent a resolver from reporting an incorrect value. Gaussian curves can also fit discrete or skewed outcomes poorly.</p>
      </section>

      <section id="inside" className="landing-inside" aria-labelledby="inside-title">
        <div className="inside-intro"><p className="landing-kicker">✳ INSIDE THE PROJECT</p><h2 id="inside-title">A small stack.<br />A complete lifecycle.</h2><p>The browser expresses a forecast. The contract holds the money and enforces the rules. Resolver scripts bring in the observation.</p><a href="https://github.com/debojyoti10CC/dass" target="_blank" rel="noreferrer">Explore the repository ↗</a></div>
        <div className="repo-map">
          <details open><summary><code>web/</code><span>The experience</span></summary><p>React and TypeScript power discovery, curve editing, review, positions and operator tools. viem reads Arc and prepares wallet transactions. Exact approvals, fresh simulations and nonce checks protect forecast submissions.</p><a href={`${source}web/src/useWorkspace.ts`}>useWorkspace.ts</a><a href={`${source}web/src/chain.ts`}>chain.ts</a><a href={`${source}web/src/Charts.tsx`}>Charts.tsx</a></details>
          <details><summary><code>contracts/</code><span>The accounting</span></summary><p>One non-upgradeable DistributionMarkets contract stores markets, receipts and liabilities. GaussianMath evaluates bounded curves. Individual claims have no loop over trading history, and failed transfers preserve claim rights.</p><a href={`${source}contracts/src/DistributionMarkets.sol`}>DistributionMarkets.sol</a><a href={`${source}contracts/src/GaussianMath.sol`}>GaussianMath.sol</a></details>
          <details><summary><code>scripts/ + config/</code><span>The operations</span></summary><p>Deployment, market creation, oracle checks and evidence archival live here. Existing Coinbase and football markets keep their committed policies. New support includes Chainlink BTC observations and agreement across three football providers.</p><p>For testnet Chainlink markets, a trusted resolver reads the mainnet feed off-chain. This is not a verified cross-chain relay.</p><a href={`${source}scripts/real-markets.mjs`}>real-markets.mjs</a><a href={`${source}docs/oracle-health.md`}>Oracle policy</a></details>
          <details><summary><code>reference/</code><span>The numerical model</span></summary><p>An independent 90-digit Python model checks the fixed-point evaluator. Coordinates use 18 decimals; collateral and payouts use six. Integer accounting conservation and numerical approximation accuracy are checked separately.</p><a href={`${source}reference/model.py`}>model.py</a><a href={`${source}reference/numeric-spec.md`}>Numeric specification</a></details>
          <details><summary><code>test/</code><span>The failure cases</span></summary><p>Tests cover lifecycle boundaries, stale forecasts, claim order, token failures, reentrancy, oracle disagreement and browser recovery. Arc-runtime tests exercise native USDC behavior; browser tests also check mobile and keyboard flows.</p><a href={`${source}test/contracts.test.mjs`}>Contract checks</a><a href={`${source}contracts/test/ArcRuntime.t.sol`}>Arc runtime checks</a></details>
          <details><summary><code>deployments/ + docs/</code><span>The evidence</span></summary><p>Manifests identify deployed contracts. Receipt records document settlement and refunds. Runbooks explain reproduction, while release checks bind evidence to exact source fingerprints so old checks cannot approve changed code.</p><a href={`${source}deployments/README.md`}>Deployment records</a><a href={`${source}Architecture.md`}>Architecture</a><a href={`${source}Rules.md`}>Market rules</a></details>
        </div>
      </section>

      <section className="landing-evidence" aria-labelledby="evidence-title"><div><p className="landing-kicker">✳ BUILT, WITH BOUNDARIES</p><h2 id="evidence-title">Evidence you can inspect.</h2><p>Repository records, not a live network-status report.</p></div><div className="evidence-rows"><a href={`${source}deployments/arc-testnet-acceptance-evidence.json`}><span>Public testnet settlement</span><strong>3 USDC deposited → 3 USDC paid ↗</strong></a><a href={`${source}deployments/arc-testnet-expiry-evidence.json`}><span>Expiry recovery exercise</span><strong>2 USDC deposited → 2 USDC refunded ↗</strong></a><a href={`${source}reference/fixtures.json`}><span>Recorded numerical checks</span><strong>189 fixtures · 600 claim-order checks ↗</strong></a><div><span>Release boundary</span><strong>Mainnet undeployed. No independent audit.</strong></div></div><p className="evidence-note">The newer Chainlink browser settlement run is incomplete. Changed source needs refreshed release evidence. Historical testnet records do not establish production readiness.</p></section>

    </main>
  </div>
}
