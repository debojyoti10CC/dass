import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { formatUnits, type Address } from 'viem'
import { chain, contractAddress, coordinate, formatCoordinate, prepareApproval, prepareCall, readMarket, readForecastEvents, tokenAddress, balances, publicClient } from './chain'
import { deployment } from './contracts'
import { Charts } from './Charts'
import { BrandMark, MarketDiscovery, MarketStatus } from './MarketDiscovery'
import { curveError, dateTime, displayStatus, fromWad, nativeUSDC, signed, usdc, utcTime } from './math'
import { fetchRules } from './rules'
import { errorMessage } from './transactions'
import { withReadDeadline, withReviewDeadline } from './review'
import type { Curve, Market, RulesResult } from './types'
import { useWorkspace, type Workspace } from './useWorkspace'
import { localAccounts, localDemoEnabled, selectLocalAccount } from './localWallet'
import { ExplorerLink } from './ExplorerLink'
import { TestnetFunding } from './TestnetFunding'

const Operator = lazy(() => import('./Operator').then(module => ({ default: module.Operator })))
function sourceURL(source?: string) {
  try { const url = new URL(source ?? ''); return url.protocol === 'https:' ? url.href : undefined } catch { return undefined }
}

const ZERO = '0x0000000000000000000000000000000000000000' as Address
const WAD = 10n ** 18n
const directionName = (mean: bigint) => mean === WAD ? 'Up' : mean === 0n ? 'Down' : 'Unselected'
const sandbox: Market = {
  id: 0n, sponsor: ZERO, resolver: ZERO, rulesHash: `0x${'0'.repeat(64)}`, rulesURI: '', units: 'units', origin: 0n, scale: 10n ** 18n, outcomeStep: 10n ** 16n,
  backing: 10000000n, k: 10n ** 19n, initialCurve: { mean: 20n * 10n ** 18n, sigma: 2500000000000000000n }, currentCurve: { mean: 20n * 10n ** 18n, sigma: 2500000000000000000n },
  minMean: -1000n * 10n ** 18n, maxMean: 1000n * 10n ** 18n, minSigma: 600000000000000000n, maxSigma: 100n * 10n ** 18n, minOutcome: -1000n * 10n ** 18n, maxOutcome: 1000n * 10n ** 18n,
  closeAt: 0n, resolveBy: 0n, nonce: 0n, status: 0, outcome: 0n, deposited: 0n, paid: 0n, sponsorClaimed: false, evidenceHash: `0x${'0'.repeat(64)}`,
}
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

function useRules(markets: Market[]) {
  const [rules, setRules] = useState<Record<string, RulesResult>>({})
  const key = markets.map(item => `${item.id}:${item.rulesHash}:${item.rulesURI}`).join('|')
  useEffect(() => {
    const controller = new AbortController()
    setRules(Object.fromEntries(markets.map(item => [item.id.toString(), { status: 'loading' } as RulesResult])))
    void Promise.all(markets.map(async item => {
      const result = await fetchRules(item.rulesURI, item.rulesHash, controller.signal)
      if (result.status === 'verified' && (result.document!.units !== item.units || coordinate(result.document!.normalization.origin) !== item.origin || coordinate(result.document!.normalization.scale) !== item.scale)) return [item.id.toString(), { status: 'mismatch', error: 'Committed rules normalization or units disagree with the immutable onchain configuration. Trading is disabled; claims remain available.' } as RulesResult] as const
      return [item.id.toString(), result] as const
    })).then(entries => { if (!controller.signal.aborted) setRules(Object.fromEntries(entries)) }).catch(() => {})
    return () => controller.abort()
  }, [key])
  return rules
}

export function App() {
  const workspace = useWorkspace()
  const knownMarkets = [...new Map([...workspace.sponsoredMarkets, ...workspace.positions.map(position => position.market), ...workspace.markets].map(item => [item.id, item])).values()]
  const rules = useRules(knownMarkets)
  const [page, setPage] = useState<'markets' | 'forecast' | 'positions' | 'operator'>(contractAddress ? 'markets' : 'forecast')
  const [selected, setSelected] = useState<string>()
  const [demoAccounts, setDemoAccounts] = useState<Address[]>([])
  const [demoAccount, setDemoAccount] = useState<Address | ''>('')
  useEffect(() => { if (localDemoEnabled()) void localAccounts().then(setDemoAccounts).catch(failure => workspace.setError(errorMessage(failure))) }, [])
  useEffect(() => { if (!demoAccount && workspace.account) setDemoAccount(workspace.account) }, [workspace.account, demoAccount])
  const market = knownMarkets.find(item => item.id.toString() === selected)
  const visit = (item: Market) => { setSelected(item.id.toString()); setPage('forecast'); window.scrollTo({ top: 0 }) }
  const disabled = workspace.busy || workspace.pending || workspace.wrongNetwork || !workspace.account
  return <>
    <a href="#main" className="skip-link">Skip to content</a>
    <header className="topbar"><div className="nav-shell"><a className="wordmark" href="/" aria-label="Dass home"><BrandMark /><span>Dass</span></a><nav aria-label="Main navigation"><button aria-current={page === 'markets' ? 'page' : undefined} onClick={() => setPage('markets')}>Markets</button><button aria-current={page === 'positions' ? 'page' : undefined} onClick={() => setPage('positions')}>My positions</button><button aria-current={page === 'operator' ? 'page' : undefined} onClick={() => setPage('operator')}>Operator</button></nav><div className="wallet-controls"><span className="network-badge"><span className="network-dot" />{chain.name}</span><TestnetFunding workspace={workspace} />{workspace.account ? <button className="secondary wallet-button" onClick={() => void workspace.connect()} title={workspace.account}>{short(workspace.account)}</button> : <button className="primary wallet-button" onClick={() => void workspace.connect()}>Connect wallet</button>}</div></div></header>
    <main id="main">
      {!contractAddress && <div className="environment-note"><span className="badge">READ-ONLY WORKSPACE</span><span>No contract deployment is configured. There are no actual markets or deposits here.</span>{chain.id === 5042002 && <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">Testnet faucet ↗</a>}</div>}
      {contractAddress && !localDemoEnabled() && <div className="environment-note"><span className="badge">{chain.id === 5042 ? 'ARC MAINNET' : 'PUBLIC ARC TESTNET'}</span><span>Real-event markets · native USDC · records read from the deployed contract</span><ExplorerLink type="address" value={contractAddress} /></div>}
      {localDemoEnabled() && <div className="environment-note local-demo-note"><span className="badge">LOCAL ARC DEMO</span><span>Disposable accounts · synthetic observations · localhost only</span><label>Demo wallet<select aria-label="Disposable demo wallet" value={demoAccount} onChange={event => { const account = event.target.value as Address; setDemoAccount(account); void selectLocalAccount(account).then(() => workspace.connect()).catch(failure => { setDemoAccount(workspace.account ?? ''); workspace.setError(errorMessage(failure)) }) }}><option value="" disabled>Select a wallet</option>{demoAccounts.map((item, index) => <option value={item} key={item}>{index === 0 ? 'Sponsor / operator' : index === 3 ? 'Trusted resolver' : `Trader ${index}`} · {short(item)}</option>)}</select></label></div>}
      {workspace.wrongNetwork && <div className="message warning" role="alert"><span>Wallet network differs from the deployment. Switch to {chain.name} (chain ID {chain.id}) before any transaction.</span><button className="secondary" onClick={() => void workspace.switchChain()}>Switch network</button></div>}
      {workspace.error && <div className="message error" role="alert">{workspace.error}</div>}
      {workspace.notice && <div className="message" role="status">{workspace.notice}</div>}
      {page === 'markets' && <MarketDiscovery markets={workspace.markets} rules={rules} timestamp={workspace.timestamp} loading={workspace.loading} visit={visit} explore={() => { setSelected(undefined); setPage('forecast'); window.scrollTo({ top: 0 }) }} refresh={() => void workspace.refresh()} />}
      {page === 'markets' && workspace.marketCount > 20n && <div className="button-row"><button disabled={workspace.marketPage === 0} onClick={() => workspace.setMarketPage(workspace.marketPage - 1)}>Newer markets</button><span>Page {workspace.marketPage + 1} · {workspace.marketCount.toString()} markets total</span><button disabled={BigInt(workspace.marketPage + 1) * 20n >= workspace.marketCount} onClick={() => workspace.setMarketPage(workspace.marketPage + 1)}>Older markets</button></div>}
      {page === 'forecast' && <><button className="text-button back-button" onClick={() => setPage('markets')}><span aria-hidden="true">←</span> All markets</button><MarketDetail key={market?.id.toString() ?? 'sandbox'} market={market ?? sandbox} sandboxMode={!market} rules={market ? rules[market.id.toString()] : undefined} workspace={workspace} /></>}
      {page === 'positions' && <><div className="page-heading"><div><p className="eyebrow">YOUR WALLET</p><h1>My positions.</h1><p className="intro">Individual receipts. Clear settlement. Direct claims.</p></div>{workspace.funds && <div className="balance-summary"><span>Shared USDC balance</span><strong>{usdc(workspace.funds.token)} USDC</strong><small>Collateral: 6 decimals · gas: 18 decimals</small></div>}</div><section className="card"><div className="section-heading"><h2>Forecast receipts</h2><button className="text-button" onClick={() => void workspace.refresh()} disabled={workspace.loading}>Refresh records</button></div>{!workspace.account ? <div className="empty-state"><h3>Connect to find your positions.</h3><p>Receipts are read from this contract’s events and rechecked against onchain ownership.</p><button className="primary" onClick={() => void workspace.connect()}>Connect wallet</button></div> : !workspace.positions.length ? <div className="empty-state"><h3>No receipts in this wallet.</h3><p>A confirmed forecast change creates a nontransferable receipt. Deposits remain locked until resolution or cancellation.</p><button className="secondary" onClick={() => setPage('markets')}>Explore markets</button></div> : workspace.positions.map(position => {
        const item = position.market, cancelled = item?.status === 2
        const binary = rules[position.marketId.toString()]?.document?.kind === 'btc-five-minute-direction'
        return <article className="position-row" key={position.id.toString()}><div><p className="eyebrow">RECEIPT #{position.id.toString()} · MARKET #{position.marketId.toString()}</p><h3>{rules[position.marketId.toString()]?.document?.question ?? `Market #${position.marketId}`}</h3><p className="muted">Owner {short(position.owner)} · {binary ? `${directionName(position.oldCurve.mean)} → ${directionName(position.newCurve.mean)}` : `μ ${formatCoordinate(position.oldCurve.mean)} → ${formatCoordinate(position.newCurve.mean)} · σ ${formatCoordinate(position.oldCurve.sigma)} → ${formatCoordinate(position.newCurve.sigma)}`}</p></div><dl className="receipt-facts"><div><dt>Deposited collateral</dt><dd>{usdc(position.deposit)} USDC</dd></div><div><dt>{cancelled ? 'Refund' : 'Settlement payout'}</dt><dd>{(position.claimable || position.claimed) ? `${usdc(position.payout)} USDC` : position.claimed ? 'Claimed' : 'Awaiting settlement'}</dd></div><div><dt>P&amp;L · fees excluded</dt><dd>{(position.claimable || position.claimed) ? `${signed(Number(position.payout - position.deposit) / 1e6)} USDC` : position.claimed ? 'See confirmed claim event' : 'Unsettled'}</dd></div></dl><div className="position-actions"><span className="badge">{position.claimed ? 'Claimed' : item ? displayStatus(item, workspace.timestamp) : 'Loading market'}</span>{position.claimable && <button className="primary" disabled={disabled} onClick={() => void workspace.execute(cancelled ? 'Claim refund' : 'Claim payout', 'claim', [position.id], 0n, position.marketId, position.id)}>{cancelled ? 'Claim refund' : 'Claim payout'}</button>}{item && <button className="text-button" onClick={() => visit(item)}>View market ↗</button>}</div></article>
      })}</section>{workspace.account && workspace.sponsoredMarkets.some(item => item.sponsor.toLowerCase() === workspace.account!.toLowerCase()) && <section className="card sponsor-section"><div className="section-heading"><h2>Sponsor entitlement</h2></div><p>The sponsor owns the initial curve and final residual: b + F(initial) − F(final). This amount includes its original backing. Cancellation refunds that backing.</p>{workspace.sponsoredMarkets.filter(item => item.sponsor.toLowerCase() === workspace.account!.toLowerCase()).map(item => <div className="sponsor-row" key={item.id.toString()}><strong>Market #{item.id.toString()}</strong><span>Backing {usdc(item.backing)} USDC</span><span>{item.sponsorClaimed ? 'Claimed' : item.status === 0 ? 'Awaiting settlement' : `${usdc(workspace.sponsorPayouts[item.id.toString()] ?? 0n)} USDC claimable`}</span>{item.status !== 0 && !item.sponsorClaimed && <button className="primary" disabled={disabled} onClick={() => void workspace.execute('Claim sponsor entitlement', 'claimSponsor', [item.id], 0n, item.id)}>Claim {item.status === 2 ? 'backing refund' : 'sponsor payout'}</button>}</div>)}</section>}</>}
      {page === 'operator' && <Suspense fallback={<p>Loading operator tools…</p>}><Operator workspace={workspace} rules={rules} /></Suspense>}
      {!!workspace.transactions.length && <section className="card transactions"><div className="section-heading"><h2>Transaction activity</h2><button className="secondary" onClick={() => void workspace.reconcile()}>Reconcile hashes</button></div><p className="fine-print">Hashes are saved in this browser. Pending or unknown transactions are reconciled against receipts before another submission. A submitted hash alone does not prove success.</p>{workspace.transactions.filter(item => item.chainId === chain.id && (!workspace.account || item.account.toLowerCase() === workspace.account.toLowerCase())).slice().reverse().map(item => <div className="transaction-row" key={item.id}><span>{item.action}</span><span className={`badge tx-${item.state}`}>{item.state}</span><ExplorerLink type="tx" value={item.hash} /><span className="muted">{new Date(item.createdAt).toLocaleString()}</span></div>)}</section>}
    </main><footer><div><strong className="footer-brand"><BrandMark />dass</strong><span>Continuous forecasts · fixed collateral · individual claims</span></div><p>{chain.id === 5042 ? 'Experimental mainnet markets · real USDC · no independent audit.' : 'Public testnet markets use test USDC.'} A trusted resolver reports outcomes. Gaussian forecasts can fit discrete or skewed outcomes poorly.</p><a href="https://www.paradigm.xyz/writing/distribution-markets" target="_blank" rel="noreferrer">Mechanism paper ↗</a></footer>
  </>
}

function MarketDetail({ market, sandboxMode, rules, workspace }: { market: Market; sandboxMode: boolean; rules?: RulesResult; workspace: Workspace }) {
  const mounted = useRef(true), walletContext = useRef({ account: workspace.account, wrongNetwork: workspace.wrongNetwork })
  walletContext.current = { account: workspace.account, wrongNetwork: workspace.wrongNetwork }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [mean, setMean] = useState(sandboxMode ? '22' : formatCoordinate(market.currentCurve.mean)), [sigma, setSigma] = useState(sandboxMode ? '3' : formatCoordinate(market.currentCurve.sigma)), [scenario, setScenario] = useState(fromWad(market.currentCurve.mean))
  const [review, setReview] = useState<{ market: Market; proposed: Curve; deadline: bigint; account: Address; approved: boolean; fee: bigint }>(), [stale, setStale] = useState(false), [working, setWorking] = useState(false)
  const [showRules, setShowRules] = useState(false)
  const binaryDirection = rules?.document?.kind === 'btc-five-minute-direction'
  const fixedDirectionSigma = market.currentCurve.sigma
  const [reviewProgress, setReviewProgress] = useState(''), [reviewError, setReviewError] = useState('')
  const [activity, setActivity] = useState<Awaited<ReturnType<typeof readForecastEvents>>>([])
  const [activityError, setActivityError] = useState('')
  useEffect(() => {
    if (sandboxMode) return
    let current = true
    const refresh = async () => { try { const events = await readForecastEvents(market.id); if (current) { setActivity(events); setActivityError('') } } catch { if (current) setActivityError('Onchain activity could not be loaded. Retry by reopening this market.') } }
    void refresh(); const timer = setInterval(() => void refresh(), 30000)
    return () => { current = false; clearInterval(timer) }
  }, [market.id, sandboxMode])
  const proposed = useMemo(() => { try { return { mean: coordinate(mean), sigma: binaryDirection ? fixedDirectionSigma : coordinate(sigma) } } catch { return undefined } }, [mean, sigma, binaryDirection, fixedDirectionSigma])
  const invalid = binaryDirection && mean !== '0' && mean !== '1' ? 'Choose Up or Down before reviewing your forecast.' : proposed ? curveError(market, proposed) : 'Enter a valid decimal for expected outcome and uncertainty.'
  const open = sandboxMode || (market.status === 0 && workspace.timestamp < market.closeAt)
  const chartMarket = review?.market ?? market, curve = proposed ?? market.currentCurve
  useEffect(() => { if (review && (review.market.nonce !== market.nonce || review.account !== workspace.account || workspace.wrongNetwork)) setStale(true) }, [market.nonce, workspace.account, workspace.wrongNetwork, review])
  const edited = (setter: (value: string) => void, value: string) => { setter(value); setReview(undefined); setStale(false); setReviewError('') }
  const checkWalletContext = (account: Address) => {
    if (!mounted.current || account !== walletContext.current.account || walletContext.current.wrongNetwork) throw new Error('Wallet or market page changed during preparation. Review your forecast again.')
  }
  const reviewForecast = async () => {
    if (sandboxMode || !workspace.account || !proposed || invalid) return
    setWorking(true); setReviewError(''); setReviewProgress('Reading the latest market…')
    let finished = false
    try {
      const account = workspace.account
      const preparedReview = await withReviewDeadline((async () => {
        const block = await publicClient.getBlock(), fresh = await readMarket(market.id, block.number)
        const issue = curveError(fresh, proposed); if (issue) throw new Error(issue)
        if (!finished) setReviewProgress('Checking USDC balance and allowance…')
        const balance = await balances(account), deadline = block.timestamp + 300n, approved = balance.allowance >= fresh.backing
        if (!finished) setReviewProgress('Simulating the transaction and estimating fees…')
        const prepared = approved ? await prepareCall(account, 'trade', [fresh.id, proposed, fresh.nonce, fresh.backing, deadline], fresh.backing) : await prepareApproval(account, fresh.backing)
        return { market: fresh, proposed, deadline, account, approved, fee: prepared.gasReserve }
      })())
      setReview(preparedReview); setStale(false); workspace.setError('')
    } catch (failure) { setReviewError(errorMessage(failure)) }
    finally { finished = true; setWorking(false); setReviewProgress('') }
  }
  const approve = async () => {
    if (!review || !workspace.account || stale) return
    const account = workspace.account
    let approvalConfirmed = false
    setWorking(true); setReviewError(''); setReviewProgress('Checking approval, wallet network, and fee reserve…')
    try {
      const prepared = await withReadDeadline((async () => {
        const block = await publicClient.getBlock(), fresh = await readMarket(market.id, block.number)
        if (fresh.nonce !== review.market.nonce || block.timestamp >= review.deadline) throw new Error('The forecast preview changed or expired. Refresh the preview before approving.')
        return prepareApproval(account, review.market.backing)
      })(), 'Approval preparation timed out while reading the network or wallet. No approval transaction was requested. Check your wallet connection and try again.')
      checkWalletContext(account)
      const result = await workspace.submitRequest('Approve exact collateral', prepared.request, market.id)
      if (result?.state === 'confirmed') {
        approvalConfirmed = true; setReviewProgress('Approval confirmed. Checking the forecast and its fees…')
        const preparedTrade = await withReadDeadline((async () => {
          const block = await publicClient.getBlock(), fresh = await readMarket(market.id, block.number)
          if (fresh.nonce !== review.market.nonce || block.timestamp >= review.deadline) throw new Error('The forecast preview changed or expired during approval. Refresh the preview before submitting.')
          return prepareCall(account, 'trade', [market.id, review.proposed, review.market.nonce, review.market.backing, review.deadline], review.market.backing)
        })(), 'Post-approval checks timed out. The approval is confirmed; prepare a fresh forecast review before submitting.')
        checkWalletContext(account)
        setReview({ ...review, approved: true, fee: preparedTrade.gasReserve })
      } else if (result?.state === 'reverted') setReviewError('Approval reverted onchain. No allowance change was applied; the network fee may still be charged.')
    } catch (failure) {
      const message = errorMessage(failure)
      if (/preview.*changed|preview.*expired/i.test(message)) setStale(true)
      if (approvalConfirmed) { setReview(undefined); setReviewError(`Approval confirmed. ${message} Review again to read the current allowance; a forecast has not been requested.`) }
      else setReviewError(message)
    } finally { setWorking(false); setReviewProgress('') }
  }
  const submit = async () => {
    if (!review || !workspace.account || stale) return
    const account = workspace.account
    setWorking(true); setReviewError(''); setReviewProgress('Checking the latest forecast, wallet network, and fees…')
    try {
      const prepared = await withReadDeadline((async () => {
        const block = await publicClient.getBlock(), fresh = await readMarket(market.id, block.number)
        if (fresh.nonce !== review.market.nonce || block.timestamp >= review.deadline) throw new Error('The forecast preview changed or expired. Refresh the preview before submitting.')
        return prepareCall(account, 'trade', [market.id, review.proposed, review.market.nonce, review.market.backing, review.deadline], review.market.backing)
      })(), 'Forecast preparation timed out while reading the network or wallet. No forecast transaction was requested. Check your wallet connection and try again.')
      checkWalletContext(account)
      const result = await workspace.submitRequest('Submit forecast', prepared.request, market.id)
      if (result?.state === 'confirmed') setReview(undefined)
      else if (result?.state === 'reverted') setReviewError('Forecast reverted onchain. No forecast change was applied; the network fee may still be charged. Prepare a fresh review.')
    } catch (failure) { const message = errorMessage(failure); if (/stale|nonce|preview.*changed|preview.*expired/i.test(message)) setStale(true); setReviewError(message) }
    finally { setWorking(false); setReviewProgress('') }
  }
  const disabled = workspace.busy || workspace.pending || workspace.wrongNetwork || working
  const pendingTransaction = workspace.transactions.slice().reverse().find(item => item.chainId === chain.id && item.account.toLowerCase() === workspace.account?.toLowerCase() && ['pending', 'unknown'].includes(item.state))
  const actionLabel = workspace.submission ? workspace.submission.stage === 'wallet' ? 'Waiting for wallet…' : 'Confirming transaction…' : working ? 'Preparing transaction…' : workspace.pending ? 'Transaction unresolved' : review?.approved ? 'Submit forecast' : `Approve ${usdc(market.backing)} USDC`
  const actionProgress = workspace.submission ? workspace.submission.stage === 'wallet' ? workspace.submission.delayed ? 'Your wallet has not returned a transaction hash. Open your wallet and approve or reject its pending request. Keep this page open; another transaction cannot be sent while it is waiting.' : 'Waiting for your wallet. Open it to approve or reject this transaction.' : 'Transaction submitted. Waiting for an onchain receipt; do not submit it again.' : reviewProgress
  return <>
    <div className="page-heading forecast-heading"><div><p className="eyebrow">{sandboxMode ? 'THE FORECAST SANDBOX' : binaryDirection ? 'BTC · FIVE-MINUTE UP / DOWN' : `MARKET #${market.id}`}</p><h1>{sandboxMode ? 'Explore a distribution.' : rules?.document?.question ?? `Market #${market.id}`}</h1><p className="intro">{sandboxMode ? 'Move the center. Change the width. See what each outcome means.' : binaryDirection ? 'Choose whether BTC will finish this window Up or Down.' : `Expected outcome ${formatCoordinate(market.currentCurve.mean)} · uncertainty ${formatCoordinate(market.currentCurve.sigma)} · ${market.units}`}</p></div>{sandboxMode ? <span className="badge">Read-only · illustrative values</span> : <MarketStatus market={market} timestamp={workspace.timestamp} />}</div>
    {!sandboxMode && <div className="market-context"><span title={utcTime(market.closeAt)}>Closes {dateTime(market.closeAt)}</span>{binaryDirection && typeof rules?.document?.windowStart === 'string' && typeof rules.document.windowEnd === 'string' && <span>Window {String(rules.document.windowStart)} → {String(rules.document.windowEnd)}</span>}<button className="text-button" onClick={() => setShowRules(!showRules)}>{showRules ? 'Hide' : 'View'} resolution rules</button><span>Trusted resolver <ExplorerLink type="address" value={market.resolver} /></span></div>}
    {!sandboxMode && rules?.document && <div className="message observation-card"><strong>{String(rules.document.category ?? 'Real-world observation')}</strong> · {sourceURL(rules.document.source) ? <a href={sourceURL(rules.document.source)} target="_blank" rel="noreferrer">Official resolution source ↗</a> : rules.document.source}<p>Observation {rules.document.observationAt}. {String(rules.document.initialForecastPolicy ?? 'The current curve is a forecast submitted onchain; it is not a live external probability feed.')}</p>{typeof rules.document.distributionCaveat === 'string' && <p>{rules.document.distributionCaveat}</p>}</div>}
    {!sandboxMode && rules?.status !== 'verified' && <div className="message warning" role="alert">{rules?.error ?? 'Verifying committed rules before enabling trade review…'} Claims and refunds remain available in My positions.</div>}
    <div className="forecast-grid">{binaryDirection ? <section className="card direction-market"><p className="eyebrow">BTC · 5 MINUTES</p><h2>Which way will BTC move?</h2><p>Compare the BTC/USD price at the start and end of this five-minute window. Ties resolve Up.</p><div className="direction-choices" role="group" aria-label="Choose BTC direction">{[['1', 'Up', '↗'], ['0', 'Down', '↘']].map(([value, label, arrow]) => <button key={value} type="button" className={`direction-choice ${mean === value ? `selected direction-${label.toLowerCase()}` : ''}`} aria-pressed={mean === value} onClick={() => edited(setMean, value)} disabled={!open || working || workspace.busy || workspace.pending}><span aria-hidden="true">{arrow}</span><strong>{label}</strong><small>{mean === value ? 'Selected' : 'Choose this outcome'}</small></button>)}</div><p className="fine-print">Payout depends on the full Gaussian forecast curve and resolved outcome. This is not a fixed $1 share or displayed probability.</p>{invalid && <p className="inline-error" role="alert">{invalid}</p>}</section> : <Charts market={chartMarket} proposed={curve} scenario={scenario} setScenario={setScenario} />}<aside className="editor card"><div className="editor-heading"><span className="editor-icon" aria-hidden="true">∿</span><h2>{binaryDirection ? 'Review your direction' : 'Change your forecast'}</h2></div><p className="muted">{binaryDirection ? 'Choose one outcome for this BTC window.' : <>A number for the center.<br />A width for your uncertainty.</>}</p>{binaryDirection ? <div className="direction-current"><span>Selected forecast</span><strong>{directionName(coordinate(mean))}</strong><small>Forecast width is fixed for this market.</small></div> : <><div className="control"><label htmlFor="forecast-mean">Expected outcome <span>μ</span></label><div className="input-unit"><input id="forecast-mean" type="number" value={mean} min={fromWad(market.minMean)} max={fromWad(market.maxMean)} step="0.1" onChange={event => edited(setMean, event.target.value)} disabled={!open || working || workspace.busy || workspace.pending} /><span>normalized units</span></div><input aria-label="Expected outcome slider" type="range" min={Math.max(fromWad(market.minMean), fromWad(market.currentCurve.mean) - 15)} max={Math.min(fromWad(market.maxMean), fromWad(market.currentCurve.mean) + 15)} step="0.1" value={Number(mean)} onChange={event => edited(setMean, event.target.value)} disabled={!open || working || workspace.busy || workspace.pending} /><div className="range-labels"><span>Lower outcome</span><span>Higher outcome</span></div></div><div className="control"><label htmlFor="forecast-sigma">Uncertainty <span>σ</span></label><div className="input-unit"><input id="forecast-sigma" type="number" value={sigma} min={fromWad(market.minSigma)} max={fromWad(market.maxSigma)} step="0.1" onChange={event => edited(setSigma, event.target.value)} disabled={!open || working || workspace.busy || workspace.pending} /><span>standard deviation</span></div><input aria-label="Uncertainty slider" type="range" min={fromWad(market.minSigma)} max={Math.min(fromWad(market.maxSigma), Math.max(10, fromWad(market.currentCurve.sigma) * 3))} step="0.1" value={Number(sigma)} onChange={event => edited(setSigma, event.target.value)} disabled={!open || working || workspace.busy || workspace.pending} /><div className="range-labels"><span>More certain</span><span>Less certain</span></div></div></>}{invalid && <p className="inline-error" role="alert">{invalid}</p>}<div className="collateral"><span>Fixed collateral</span><strong>{usdc(market.backing)} <small>USDC</small></strong><p>Every forecast change deposits this amount. It is collateral, not a fee. Uncertainty does not change the deposit.</p></div><dl className="editor-facts"><div><dt>Fee reserve</dt><dd>{review ? `≈ ${nativeUSDC(review.fee)} USDC` : 'Estimate at review'}</dd></div><div><dt>Conservative payout bound</dt><dd>0–{usdc(market.backing * 2n)} USDC</dd></div><div><dt>Funds unlocked</dt><dd>{sandboxMode ? 'Illustration only' : 'Resolution or cancellation'}</dd></div></dl>{sandboxMode ? <div className="sandbox-disclosure"><strong>Explore freely.</strong><p>This is a read-only mechanism example. These values are not an actual market. No approval, deposit, or receipt can be created.</p></div> : !open ? <div className="message">Trading is closed. Use My positions for settlement claims.</div> : review ? <div className="trade-review"><p className="eyebrow">REVIEW YOUR FORECAST</p><p>{binaryDirection ? `Current ${directionName(review.market.currentCurve.mean)} → proposed ${directionName(review.proposed.mean)}.` : `Current μ ${fromWad(review.market.currentCurve.mean)}, σ ${fromWad(review.market.currentCurve.sigma)} → proposed μ ${fromWad(review.proposed.mean)}, σ ${fromWad(review.proposed.sigma)}.`}</p><p>Trusted resolver: {short(market.resolver)}. Funds remain locked until resolution or expiry cancellation.</p><p className="fine-print">Nonce {review.market.nonce.toString()} · quote expires {new Date(Number(review.deadline) * 1000).toISOString()}. Fees share your USDC balance. {review.approved ? 'The fee reserve is rechecked after approval and before submission.' : 'This includes a provisional trade reserve; actual fees are estimated again after approval.'}</p>{stale ? <><p className="inline-error">The preview is stale. Review the new payout curve before taking another action.</p><button className="primary full-width" onClick={() => void reviewForecast()} disabled={disabled}>Refresh preview</button></> : <button className="primary full-width" onClick={() => void (review.approved ? submit() : approve())} disabled={disabled}>{actionLabel}</button>}<button className="text-button" disabled={working || workspace.busy} onClick={() => setReview(undefined)}>Back to editing</button></div> : !workspace.account ? <button className="primary full-width" onClick={() => void workspace.connect()}>Connect to review forecast</button> : <button className="primary full-width" onClick={() => void reviewForecast()} disabled={disabled || !!invalid || rules?.status !== 'verified'}>{working ? 'Preparing review…' : 'Review forecast'} <span aria-hidden="true">→</span></button>}{actionProgress && <p className="review-progress" role="status">{actionProgress}</p>}{workspace.submission?.hash && <p className="review-progress"><ExplorerLink type="tx" value={workspace.submission.hash} /></p>}{pendingTransaction && !workspace.submission && <div className="review-recovery"><p role="status">{pendingTransaction.action}: {pendingTransaction.state === "unknown" ? "confirmation unknown" : "pending confirmation"}. Reconcile this hash before another transaction.</p><ExplorerLink type="tx" value={pendingTransaction.hash} /><button className="text-button" onClick={() => void withReadDeadline(workspace.reconcile(), "Status check timed out. The transaction remains unresolved; check the explorer before retrying.").catch(failure => setReviewError(errorMessage(failure)))}>Check transaction status</button></div>}{reviewError && <p className="inline-error review-error" role="alert">{reviewError}</p>}<p className="fine-print">{binaryDirection ? 'Direction receipts use the Gaussian market settlement rule; Up and Down do not imply fixed share payouts. Network fees are separate.' : <>Density is not the probability of an exact outcome. P&amp;L is payout minus deposit; network fees are separate.</>}</p></aside></div>
    {!sandboxMode && <section className="card market-activity"><div className="section-heading"><h2>Onchain forecasts</h2><span className="muted">Latest confirmed contract events</span></div>{activityError ? <p>{activityError}</p> : activity.length ? activity.map(event => <div className="transaction-row" key={event.receiptId.toString()}><span>Receipt #{event.receiptId.toString()}</span><span>{usdc(event.deposit)} USDC deposited{binaryDirection ? ` · ${directionName(event.newMean)}` : ''}</span><ExplorerLink type="address" value={event.owner} /><ExplorerLink type="tx" value={event.hash} /></div>) : <p className="muted">No confirmed forecast events loaded for this market.</p>}</section>}
    {!sandboxMode && <section className="card rules-card" aria-label="Market rules and accounting"><div className="section-heading"><h2>Resolution &amp; backing</h2><span className="badge">Rules {rules?.status ?? 'loading'}</span></div><dl className="rules-grid"><div><dt>Resolver</dt><dd>{market.resolver}<small>This address is trusted to report the observation correctly.</small></dd></div><div><dt>Resolution deadline</dt><dd title={utcTime(market.resolveBy)}>{dateTime(market.resolveBy)}<small>Resolution requires close ≤ time &lt; deadline. Anyone may cancel at expiry.</small></dd></div><div><dt>Canonical normalization</dt><dd>x = (raw − {formatCoordinate(market.origin)}) / {formatCoordinate(market.scale)}<small>Outcome step {formatCoordinate(market.outcomeStep)}. Round to the nearest normalized step; exact ties round away from zero.</small></dd></div><div><dt>Tracked market escrow</dt><dd>{usdc(market.deposited - market.paid)} USDC outstanding<small>{usdc(market.deposited)} deposited · {usdc(market.paid)} paid</small></dd></div></dl>{market.status === 1 && <p>Final {binaryDirection ? 'direction' : 'normalized outcome'} <strong className="number">{binaryDirection ? directionName(market.outcome) : formatCoordinate(market.outcome)}</strong>. Evidence commitment <code>{market.evidenceHash}</code>. The commitment proves integrity, not truth.</p>}{market.status === 0 && workspace.timestamp >= market.resolveBy && <button className="primary" disabled={disabled || !workspace.account} onClick={() => void workspace.execute('Cancel expired market', 'cancelExpired', [market.id], 0n, market.id)}>Cancel expired market</button>}{showRules && (rules?.document ? <dl className="rules-document">{Object.entries(rules.document).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd></div>)}</dl> : <p className="inline-error">{rules?.error ?? 'Rules not yet available.'}</p>)}<details><summary>Committed document and contract</summary><p>Rules hash <code>{market.rulesHash}</code></p><p>Rules URI <code>{market.rulesURI}</code></p><p>Contract <ExplorerLink type="address" value={contractAddress!} full /> · token {tokenAddress}</p><p>Backing b {usdc(market.backing)} USDC · norm k {formatUnits(market.k, 18)}. Sponsor entitlement includes initial curve ownership.</p></details></section>}
  </>
}
