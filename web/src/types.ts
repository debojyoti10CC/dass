import type { Address, Hash } from 'viem'

export type Curve = { mean: bigint; sigma: bigint }
export type Market = {
  id: bigint; sponsor: Address; resolver: Address; rulesHash: Hash; rulesURI: string;
  units: string; origin: bigint; scale: bigint; outcomeStep: bigint; backing: bigint; k: bigint;
  initialCurve: Curve; currentCurve: Curve; minMean: bigint; maxMean: bigint;
  minSigma: bigint; maxSigma: bigint; minOutcome: bigint; maxOutcome: bigint;
  closeAt: bigint; resolveBy: bigint; nonce: bigint; status: number; outcome: bigint;
  deposited: bigint; paid: bigint; sponsorClaimed: boolean; evidenceHash: Hash;
}
export type Position = {
  id: bigint; owner: Address; marketId: bigint; oldCurve: Curve; newCurve: Curve;
  deposit: bigint; claimed: boolean; payout: bigint; claimable: boolean;
}
export type RulesDocument = {
  question: string; source: string; field: string; observationAt: string;
  publicationPolicy: string; units: string; normalization: { origin: string; scale: string };
  precision: string; rounding: string; missingData: string; evidencePolicy: string;
  [key: string]: unknown;
}
export type RulesResult = { status: 'loading' | 'verified' | 'unavailable' | 'mismatch'; document?: RulesDocument; error?: string }
export type TransactionRecord = {
  id: string; hash: Hash; chainId: number; deploymentContext: string; account: Address; action: string;
  marketId?: string; receiptId?: string; createdAt: number;
  state: 'pending' | 'unknown' | 'confirmed' | 'reverted'; blockNumber?: string;
}
