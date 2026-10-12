import { useState } from 'react'
import { isAddress, keccak256, toBytes, type Address, type Hash } from 'viem'
import { balances, coordinate, formatCoordinate, prepareApproval, prepareCall, readContract } from './chain'
import { deployment } from './contracts'
import { dateTime, displayStatus, fromWad, nativeUSDC, usdc } from './math'
import { fetchRules, rulesHash, serializeRules, validateRules, validateEvidenceRules } from './rules'
import { errorMessage } from './transactions'
import type { Market, RulesResult } from './types'
import type { Workspace } from './useWorkspace'

const exampleRules = JSON.stringify({
  question: 'Enter the exact question for your numeric observation', source: '', field: '', observationAt: '', publicationPolicy: 'First valid publication; later revisions are ignored.', units: '', normalization: { origin: '0', scale: '1' }, precision: '0.01 normalized units', rounding: 'Round the normalized observation to the nearest outcome-step multiple; exact ties round away from zero.', missingData: 'If the source is unavailable or inadmissible before resolveBy, do not resolve. Anyone may cancel at expiry.', evidencePolicy: 'Publish the original source observation, raw value, observation time, publication time, and normalized outcome as canonical JSON; commit its hash.'
}, null, 2)

function downloadExact(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url)
}
type CreateConfig = {
  resolver: Address; rulesHash: Hash; rulesURI: string; units: string; origin: bigint; scale: bigint;
  outcomeStep: bigint; backing: bigint; k: bigint; minMean: bigint; maxMean: bigint; minSigma: bigint;
  maxSigma: bigint; minOutcome: bigint; maxOutcome: bigint; closeAt: bigint; resolveBy: bigint;
}

export function Operator({ workspace, rules }: { workspace: Workspace; rules: Record<string, RulesResult> }) {
  const [rawRules, setRawRules] = useState(exampleRules), [uri, setURI] = useState(''), [resolver, setResolver] = useState('')
  const [backing, setBacking] = useState('10'), [k, setK] = useState('5'), [mean, setMean] = useState('0'), [sigma, setSigma] = useState('1')
  const [close, setClose] = useState(''), [deadline, setDeadline] = useState('')
  const [bounds, setBounds] = useState({ minMean: '-1000', maxMean: '1000', minSigma: '0.15', maxSigma: '100', minOutcome: '-1000', maxOutcome: '1000', outcomeStep: '0.01' })
  const [working, setWorking] = useState(false), [review, setReview] = useState<{ config: CreateConfig; initial: { mean: bigint; sigma: bigint }; approved: boolean; fee: bigint }>()
  const operator = workspace.account?.toLowerCase() === workspace.operator?.toLowerCase()
  const disabled = !workspace.account || workspace.wrongNetwork || workspace.busy || workspace.pending || working
  const edit = (setter: (value: string) => void, value: string) => { setter(value); setReview(undefined) }
  const draft = () => {
    const document = validateRules(JSON.parse(rawRules))
    if (!isAddress(resolver) || /^0x0{40}$/i.test(resolver)) throw new Error('Enter a nonzero resolver wallet address.')
    if (!/^\d+(\.\d{1,6})?$/.test(backing)) throw new Error('Backing uses at most six USDC decimal places.')
    const backingMicro = coordinate(backing) / 10n ** 12n
    if (backingMicro < 1000000n || backingMicro > 1000000000n) throw new Error('Certified backing range is 1–1000 USDC.')
    const closeAt = BigInt(Math.floor(Date.parse(`${close}Z`) / 1000)), resolveBy = BigInt(Math.floor(Date.parse(`${deadline}Z`) / 1000))
    if (closeAt <= workspace.timestamp || resolveBy <= closeAt) throw new Error('Choose future close time and a strictly later resolution deadline.')
    if (Date.parse(document.observationAt) < Number(closeAt) * 1000 || Date.parse(document.observationAt) >= Number(resolveBy) * 1000) throw new Error('The declared observation must fall at/after close and before the resolution deadline.')
    const config: CreateConfig = {
      resolver, rulesHash: rulesHash(document), rulesURI: uri, units: document.units,
      origin: coordinate(document.normalization.origin), scale: coordinate(document.normalization.scale),
      backing: backingMicro, k: coordinate(k), minMean: coordinate(bounds.minMean), maxMean: coordinate(bounds.maxMean),
      minSigma: coordinate(bounds.minSigma), maxSigma: coordinate(bounds.maxSigma), minOutcome: coordinate(bounds.minOutcome),
      maxOutcome: coordinate(bounds.maxOutcome), outcomeStep: coordinate(bounds.outcomeStep), closeAt, resolveBy,
    }
    const WAD = 10n ** 18n
    if (config.scale <= 0n || config.outcomeStep <= 0n || config.outcomeStep > WAD || config.minOutcome % config.outcomeStep !== 0n || config.maxOutcome % config.outcomeStep !== 0n) throw new Error('Normalization scale must be positive. Outcome step must be (0,1], and outcome endpoints must align to that step.')
    if (config.minMean < -1000n * WAD || config.maxMean > 1000n * WAD || config.minMean > config.maxMean || config.minOutcome < -1000n * WAD || config.maxOutcome > 1000n * WAD || config.minOutcome >= config.maxOutcome || config.minSigma < 10n ** 16n || config.maxSigma > 100n * WAD || config.minSigma > config.maxSigma) throw new Error('Use certified coordinate bounds ±1000 and uncertainty 0.01–100, with ordered endpoints.')
    const initial = { mean: coordinate(mean), sigma: coordinate(sigma) }
    if (config.k <= 0n || config.k > 10n ** 22n || initial.mean < config.minMean || initial.mean > config.maxMean || initial.sigma < config.minSigma || initial.sigma > config.maxSigma) throw new Error('Initial curve and norm must be inside the certified configuration bounds.')
    if (fromWad(config.k) / Math.sqrt(fromWad(initial.sigma) * Math.sqrt(Math.PI)) > Number(config.backing) / 1e6 - 1e-6) throw new Error('Initial Gaussian peak exceeds backing minus the one micro-USDC numerical safety margin.')
    return { document, config, initial }
  }
  const downloadRules = () => { try { const doc = validateRules(JSON.parse(rawRules)); downloadExact(serializeRules(doc), 'market-rules.json'); workspace.setNotice('Downloaded canonical rules. Publish these exact bytes at a durable URL before reviewing creation.') } catch (failure) { workspace.setError(errorMessage(failure)) } }
  const prepare = async () => {
    if (!workspace.account || !operator) return
    setWorking(true)
    try {
      const next = draft(), verified = await fetchRules(uri, next.config.rulesHash)
      if (verified.status !== 'verified') throw new Error(verified.error ?? 'Publish the canonical rules document before creating the market.')
      const funds = await balances(workspace.account), approved = funds.allowance >= next.config.backing
      const prepared = approved ? await prepareCall(workspace.account, 'createMarket', [next.config, next.initial], next.config.backing) : await prepareApproval(workspace.account, next.config.backing)
      setReview({ config: next.config, initial: next.initial, approved, fee: prepared.gasReserve }); workspace.setError('')
    } catch (failure) { workspace.setError(errorMessage(failure)) } finally { setWorking(false) }
  }
  const submit = async () => {
    if (!review || !workspace.account) return
    setWorking(true)
    try {
      if (!review.approved) {
        const prepared = await prepareApproval(workspace.account, review.config.backing)
        const result = await workspace.submitRequest('Approve sponsor backing', prepared.request)
        if (result?.state === 'confirmed') {
          const next = await prepareCall(workspace.account, 'createMarket', [review.config, review.initial], review.config.backing)
          setReview({ ...review, approved: true, fee: next.gasReserve })
        }
      } else {
        const verified = await fetchRules(review.config.rulesURI, review.config.rulesHash)
        if (verified.status !== 'verified') throw new Error('Published rules stopped matching the commitment. Restore the exact file before creation.')
        const next = await prepareCall(workspace.account, 'createMarket', [review.config, review.initial], review.config.backing)
        const result = await workspace.submitRequest('Create funded market', next.request)
        if (result?.state === 'confirmed') setReview(undefined)
      }
    } catch (failure) { workspace.setError(errorMessage(failure)) } finally { setWorking(false) }
  }
  return <><div className="page-heading"><div><p className="eyebrow">SPONSOR &amp; RESOLVER</p><h1>Market operations.</h1><p className="intro">Immutable rules. Fixed backing. A verifiable final observation.</p></div><span className="badge">Trusted resolver MVP</span></div>
    {!deployment.address && <div className="message">Deploy and verify the contract, then generate the ABI and manifest to enable operations. This form prepares the immutable market definition.</div>}
    {workspace.account && workspace.operator && !operator && <div className="message warning">Only the configured operator ({workspace.operator}) can create a market. Resolver actions depend on each market’s immutable resolver.</div>}
    <section className="card"><div className="section-heading"><h2>Create a market</h2><span className="badge">Operator only</span></div><p className="muted">The creating wallet is the sponsor and deposits b. It retains initial curve ownership. Publish rules before funding; every field below is immutable after creation.</p>
      <div className="operator-grid"><div><label className="field">Committed rules JSON<textarea rows={15} spellCheck={false} value={rawRules} onChange={event => edit(setRawRules, event.target.value)} /></label><div className="button-row"><button className="secondary" onClick={downloadRules}>Download canonical rules</button></div><label className="field">Published rules URL<input placeholder="https://…/market-rules.json" value={uri} onChange={event => edit(setURI, event.target.value)} /></label><label className="field">Trusted resolver wallet<input placeholder="0x…" value={resolver} onChange={event => edit(setResolver, event.target.value)} /></label></div><div><div className="form-grid"><label className="field">Backing b · USDC<input type="number" min="1" max="1000" step="0.000001" value={backing} onChange={event => edit(setBacking, event.target.value)} /></label><label className="field">Norm k · USDC WAD scale<input type="number" min="0" value={k} onChange={event => edit(setK, event.target.value)} /></label><label className="field">Initial mean μ<input type="number" value={mean} onChange={event => edit(setMean, event.target.value)} /></label><label className="field">Initial uncertainty σ<input type="number" min="0.01" max="100" step="0.01" value={sigma} onChange={event => edit(setSigma, event.target.value)} /></label></div><label className="field">Trading close · UTC<input type="datetime-local" value={close} onChange={event => edit(setClose, event.target.value)} /></label><label className="field">Resolution deadline · UTC<input type="datetime-local" value={deadline} onChange={event => edit(setDeadline, event.target.value)} /></label><p className="fine-print">Entered date/time is UTC. The committed observation uses an ISO timestamp ending in Z.</p><details className="bounds"><summary>Certified numeric bounds and outcome precision</summary><div className="form-grid">{Object.entries(bounds).map(([key, value]) => <label className="field" key={key}>{key}<input type="number" step="0.01" value={value} onChange={event => { setBounds({ ...bounds, [key]: event.target.value }); setReview(undefined) }} /></label>)}</div></details>{review ? <div className="trade-review"><h3>Review immutable creation</h3><p>Deposit {usdc(review.config.backing)} USDC plus ≈ {nativeUSDC(review.fee)} USDC fee reserve. {review.approved ? 'Simulation passed after approval.' : 'Includes a provisional transaction reserve.'}</p><p>μ {fromWad(review.initial.mean)} · σ {fromWad(review.initial.sigma)} · resolver {review.config.resolver}</p><p>Closes {dateTime(review.config.closeAt)}. Expires {dateTime(review.config.resolveBy)}.</p><p>Rules hash <code>{review.config.rulesHash}</code></p><p>This fixes source policy, normalization, numeric ranges, resolver, and backing. The trusted resolver can report an incorrect value.</p><button className="primary" disabled={disabled || !operator} onClick={() => void submit()}>{review.approved ? 'Create funded market' : `Approve ${usdc(review.config.backing)} USDC backing`}</button><button className="text-button" onClick={() => setReview(undefined)}>Edit configuration</button></div> : <button className="primary" disabled={disabled || !operator || !deployment.address} onClick={() => void prepare()}>{working ? 'Checking rules and funding…' : 'Review market creation'}</button>}</div></div>
    </section><section className="card resolution-section"><div className="section-heading"><h2>Resolve or expire</h2><span className="muted">Per-market permissions</span></div>{!workspace.markets.length ? <p className="muted">No onchain markets available for resolution.</p> : workspace.markets.map(market => <Resolution key={market.id.toString()} market={market} rules={rules[market.id.toString()]} workspace={workspace} />)}</section>
  </>
}

function Resolution({ market, rules, workspace }: { market: Market; rules?: RulesResult; workspace: Workspace }) {
  const [rawValue, setRawValue] = useState(''), [evidence, setEvidence] = useState(''), [evidenceURI, setEvidenceURI] = useState(''), [working, setWorking] = useState(false)
  const [review, setReview] = useState<{ outcome: bigint; hash: Hash; raw: string }>()
  const canResolve = market.status === 0 && workspace.timestamp >= market.closeAt && workspace.timestamp < market.resolveBy && workspace.account?.toLowerCase() === market.resolver.toLowerCase()
  const expired = market.status === 0 && workspace.timestamp >= market.resolveBy
  const disabled = !workspace.account || workspace.wrongNetwork || workspace.busy || workspace.pending || working
  const prepare = async () => {
    setWorking(true)
    try {
      if (!rules?.document || rules.status !== 'verified') throw new Error('Verified committed rules are required before preparing resolution.')
      if (rules.document.oracleHealth || rules.document.chainlink) throw new Error('This market requires oracle evidence validation. Resolve it with the protected resolver command.')
      const outcome = await readContract('normalizeOutcome', [market.id, coordinate(rawValue)]) as bigint
      const doc = JSON.parse(evidence) as Record<string, unknown>
      validateEvidenceRules(doc, rules.document, market.rulesHash)
      if (doc.rawValue !== rawValue || String(doc.normalizedOutcome) !== fromWad(outcome).toString()) throw new Error(`Evidence rawValue must be "${rawValue}" and normalizedOutcome "${fromWad(outcome)}".`)
      if (typeof doc.publicationAt !== 'string' || !doc.publicationAt.endsWith('Z') || !Number.isFinite(Date.parse(doc.publicationAt))) throw new Error('Evidence publicationAt must be a valid UTC timestamp ending in Z.')
      if (typeof doc.observation !== 'string' || !doc.observation.trim()) throw new Error('Evidence must include the original observation text in observation.')
      const exact = serializeRules(doc), hash = keccak256(toBytes(exact))
      const url = new URL(evidenceURI); if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Evidence requires a durable HTTPS URL.')
      const response = await fetch(url, { cache: 'no-store' }); if (!response.ok || keccak256(new Uint8Array(await response.arrayBuffer())) !== hash) throw new Error('Publish the exact downloaded evidence JSON before resolution; the URL bytes must match its hash.')
      await prepareCall(workspace.account!, 'resolve', [market.id, outcome, hash])
      setReview({ outcome, hash, raw: rawValue }); workspace.setError('')
    } catch (failure) { workspace.setError(errorMessage(failure)) } finally { setWorking(false) }
  }
  return <article className="resolution-market"><div className="section-heading"><h3>{rules?.document?.question ?? `Market #${market.id}`}</h3><span className="badge">{displayStatus(market, workspace.timestamp)}</span></div><p className="muted">Trusted resolver {market.resolver}. {rules?.document?.kind === 'btc-five-minute-direction' && typeof rules.document.windowStart === 'string' && typeof rules.document.windowEnd === 'string' ? `BTC price window: ${rules.document.windowStart} to ${rules.document.windowEnd}.` : `Resolution window: ${dateTime(market.closeAt)} to ${dateTime(market.resolveBy)} (exclusive).`}</p>{market.status === 1 && <p>Final {rules?.document?.kind === 'btc-five-minute-direction' ? 'direction' : 'normalized outcome'} {rules?.document?.kind === 'btc-five-minute-direction' ? (market.outcome === 10n ** 18n ? 'Up' : 'Down') : formatCoordinate(market.outcome)} · evidence <code>{market.evidenceHash}</code></p>}{canResolve && <div className="operator-grid"><div><label className="field">Raw observation · {market.units}<input type="number" step="any" value={rawValue} onChange={event => { setRawValue(event.target.value); setReview(undefined) }} /></label><label className="field">Evidence JSON<textarea rows={8} value={evidence} placeholder={'{"rulesHash":"…","units":"…","normalization":{"origin":"0","scale":"1"},"precision":"…","rounding":"…","source":"…","field":"…","observationAt":"…Z","publicationPolicy":"…","rawValue":"…","normalizedOutcome":"…","publicationAt":"…Z","observation":"Original observation text"}'} onChange={event => { setEvidence(event.target.value); setReview(undefined) }} /></label><button className="secondary" onClick={() => { try { downloadExact(serializeRules(JSON.parse(evidence)), `market-${market.id}-evidence.json`) } catch (failure) { workspace.setError(errorMessage(failure)) } }}>Download canonical evidence</button><label className="field">Published evidence URL<input value={evidenceURI} placeholder="https://…/evidence.json" onChange={event => { setEvidenceURI(event.target.value); setReview(undefined) }} /></label></div><div>{review ? <div className="trade-review"><h3>Review final observation</h3><p>Raw {review.raw} {market.units} → normalized outcome {formatCoordinate(review.outcome)}.</p><p>Evidence commitment <code>{review.hash}</code></p><p>Finalization is irreversible. This wallet is trusted to apply the committed source and publication rules correctly.</p><button className="primary" disabled={disabled} onClick={() => void workspace.execute('Resolve market', 'resolve', [market.id, review.outcome, review.hash], 0n, market.id)}>Finalize observation</button><button className="text-button" onClick={() => setReview(undefined)}>Back to evidence</button></div> : <button className="primary" disabled={disabled || rules?.status !== 'verified'} onClick={() => void prepare()}>Review resolution</button>}</div></div>}{market.status === 0 && !canResolve && !expired && <p className="fine-print">Resolution is available only to the immutable resolver during the declared window.</p>}{expired && <><p>Resolution deadline passed. Cancellation returns each trader’s original deposit and sponsor backing; market P&amp;L is zero.</p><button className="primary" disabled={disabled} onClick={() => void workspace.execute('Cancel expired market', 'cancelExpired', [market.id], 0n, market.id)}>Cancel expired market</button></>}</article>
}
