import type { Curve, Market } from './types'

export const fromWad = (value: bigint) => Number(value) / 1e18
export const usdc = (value: bigint) => (Number(value) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6, minimumFractionDigits: 2 })
export const nativeUSDC = (value: bigint) => (Number(value) / 1e18).toLocaleString('en-US', { maximumFractionDigits: 6 })
export const signed = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(4)}`
export function density(curve: Curve, outcome: number): number {
  const sigma = fromWad(curve.sigma), distance = (outcome - fromWad(curve.mean)) / sigma
  return Math.exp(-distance * distance / 2) / (sigma * Math.sqrt(2 * Math.PI))
}
/** Display only. Settlement and actionable claim amounts always come from the contract. */
export function evaluatePreview(curve: Curve, outcome: number, k: bigint, backing: bigint): number {
  const sigma = fromWad(curve.sigma), distance = (outcome - fromWad(curve.mean)) / sigma
  if (Math.abs(distance) >= 8) return 0
  const result = fromWad(k) / Math.sqrt(sigma * Math.sqrt(Math.PI)) * Math.exp(-distance * distance / 2)
  return Math.min(Number(backing) / 1e6, Math.max(0, Math.round(result * 1e6) / 1e6))
}
export function previewPnL(market: Pick<Market, 'currentCurve' | 'k' | 'backing'>, proposed: Curve, outcome: number): number {
  return evaluatePreview(proposed, outcome, market.k, market.backing) - evaluatePreview(market.currentCurve, outcome, market.k, market.backing)
}
export function curveError(market: Market, proposed: Curve): string {
  if (proposed.mean < market.minMean || proposed.mean > market.maxMean) return `Expected outcome must be between ${fromWad(market.minMean)} and ${fromWad(market.maxMean)}.`
  if (proposed.sigma < market.minSigma || proposed.sigma > market.maxSigma) return `Uncertainty must be between ${fromWad(market.minSigma)} and ${fromWad(market.maxSigma)}.`
  const peak = fromWad(market.k) / Math.sqrt(fromWad(proposed.sigma) * Math.sqrt(Math.PI))
  if (peak > Number(market.backing) / 1e6 - 1e-6) return 'Uncertainty is too small for this market’s backing and numerical safety margin.'
  if (proposed.mean === market.currentCurve.mean && proposed.sigma === market.currentCurve.sigma) return 'Change the expected outcome or uncertainty to create a new forecast.'
  return ''
}
export function displayStatus(market: Market, now: bigint): string {
  if (market.status === 1) return 'Resolved'
  if (market.status === 2) return 'Cancelled'
  if (now >= market.resolveBy) return 'Expired · cancellation available'
  if (now >= market.closeAt) return 'Closed · awaiting resolution'
  return 'Open'
}
export function dateTime(timestamp: bigint): string {
  return new Date(Number(timestamp) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZoneName: undefined }) + ` (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
}
export const utcTime = (timestamp: bigint) => new Date(Number(timestamp) * 1000).toISOString()
