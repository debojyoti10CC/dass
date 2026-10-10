import type { TransactionRecord } from './types'
import { deployment } from './contracts'

// Local Arc and public testnet share a chain ID. Never mix their transaction records.
export const transactionContext = `${deployment.chainId}:${deployment.rpcUrl}:${deployment.address ?? 'undeployed'}`
const STORAGE_KEY = `dass.transactions.v2:${transactionContext}`
export function loadTransactions(): TransactionRecord[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((item): item is TransactionRecord => !!item && typeof item === 'object' && item.deploymentContext === transactionContext && /^0x[0-9a-fA-F]{64}$/.test(item.hash) && /^0x[0-9a-fA-F]{40}$/.test(item.account) && ['pending', 'unknown', 'confirmed', 'reverted'].includes(item.state) && Number.isInteger(item.chainId) && typeof item.action === 'string').slice(-100)
  } catch { return [] }
}
export function saveTransactions(records: TransactionRecord[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records.filter(item => item.deploymentContext === transactionContext).slice(-100))) } catch { /* Recovery remains possible using visible hashes if storage is disabled. */ }
}
export function pendingFor(records: TransactionRecord[], account: string | undefined, chainId: number): boolean {
  return records.some(item => item.account.toLowerCase() === account?.toLowerCase() && item.chainId === chainId && ['pending', 'unknown'].includes(item.state))
}
export function errorMessage(error: unknown): string {
  const item = error as { code?: number; shortMessage?: string; message?: string; cause?: { code?: number } }
  if (item?.code === 4001 || item?.cause?.code === 4001 || /user rejected|user denied/i.test(item?.message ?? '')) return 'Wallet request rejected. No transaction was submitted.'
  return item?.shortMessage ?? item?.message ?? 'The operation could not be completed.'
}
