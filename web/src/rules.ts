import { keccak256, toBytes, type Hash } from 'viem'
import type { RulesDocument, RulesResult } from './types'

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, sorted(item)]))
  return value
}
/** Commit exactly these UTF-8 bytes; no trailing newline. */
export function serializeRules(value: unknown): string { return JSON.stringify(sorted(value)) }
export function rulesHash(value: unknown): Hash { return keccak256(toBytes(serializeRules(value))) }

export function validateRules(value: unknown): RulesDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Rules must be a JSON object.')
  const doc = value as Record<string, unknown>
  for (const key of ['question', 'source', 'field', 'observationAt', 'publicationPolicy', 'units', 'precision', 'rounding', 'missingData', 'evidencePolicy']) {
    if (typeof doc[key] !== 'string' || !(doc[key] as string).trim()) throw new Error(`Rules need a nonempty ${key}.`)
  }
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(doc.observationAt as string) || !Number.isFinite(Date.parse(doc.observationAt as string))) throw new Error('observationAt must be a valid UTC ISO timestamp ending in Z.')
  const normalization = doc.normalization as Record<string, unknown> | undefined
  if (!normalization || typeof normalization.origin !== 'string' || typeof normalization.scale !== 'string' || !/^-?\d+(\.\d{1,18})?$/.test(normalization.origin) || !/^\d+(\.\d{1,18})?$/.test(normalization.scale) || !(Number(normalization.scale) > 0)) throw new Error('Rules need decimal-string normalization.origin and a positive normalization.scale, with at most 18 decimal places.')
  return doc as RulesDocument
}

export async function fetchRules(uri: string, commitment: Hash, signal?: AbortSignal): Promise<RulesResult> {
  try {
    const url = new URL(uri, window.location.origin)
    let raw: Uint8Array
    if (url.protocol === 'data:') {
      if (!/^data:application\/json;base64,[A-Za-z0-9+/]*={0,2}$/.test(uri) || uri.length > 131072) throw new Error('Embedded rules must be bounded base64 JSON.')
      raw = Uint8Array.from(atob(uri.slice('data:application/json;base64,'.length)), char => char.charCodeAt(0))
    } else {
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Rules URI must use HTTP, HTTPS or embedded base64 JSON.')
      if (url.origin !== window.location.origin && url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Remote rules require HTTPS.')
      const response = await fetch(url, { signal, cache: 'no-store' })
      if (!response.ok) throw new Error(`Rules server returned ${response.status}.`)
      raw = new Uint8Array(await response.arrayBuffer())
    }
    if (keccak256(raw).toLowerCase() !== commitment.toLowerCase()) return { status: 'mismatch', error: 'Rules bytes do not match the onchain commitment. Trading is disabled; contract claims remain available.' }
    const document = validateRules(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)))
    return { status: 'verified', document }
  } catch (error) {
    if (signal?.aborted) throw error
    return { status: 'unavailable', error: `${error instanceof Error ? error.message : 'Rules could not be loaded.'} Claims and refunds use onchain records and remain available.` }
  }
}

export function validateEvidenceRules(value: unknown, document: RulesDocument, commitment: Hash): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Evidence must be a JSON object.')
  const doc = value as Record<string, unknown>
  if (doc.rulesHash !== commitment) throw new Error('Evidence rulesHash must match the market commitment exactly.')
  for (const field of ['source', 'field', 'observationAt', 'publicationPolicy', 'units', 'precision', 'rounding'] as const) {
    if (doc[field] !== document[field]) throw new Error(`Evidence ${field} must match the committed rules exactly.`)
  }
  if (serializeRules(doc.normalization ?? null) !== serializeRules(document.normalization)) throw new Error('Evidence normalization must match the committed rules exactly.')
}
