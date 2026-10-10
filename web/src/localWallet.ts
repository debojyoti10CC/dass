import { deployment } from './contracts'
import type { Address, EIP1193Provider } from 'viem'

/** Disposable unlocked RPC accounts are available only in an explicit loopback demo. */
export function localDemoEnabled(): boolean {
  return String(deployment.status) === 'local' && new URL(deployment.rpcUrl).hostname === '127.0.0.1' && ['127.0.0.1', 'localhost'].includes(window.location.hostname)
}
const handlers = new Map<string, Set<(...args: unknown[]) => void>>()
let nextId = 0
async function localRPC(method: string, params: readonly unknown[] = []): Promise<unknown> {
  if (!localDemoEnabled()) throw new Error('Disposable accounts are restricted to an explicit localhost deployment.')
  const response = await fetch(deployment.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }) })
  const result = await response.json() as { result?: unknown; error?: { message: string; code: number } }
  if (!response.ok || result.error) throw new Error(result.error?.message ?? 'Local RPC did not respond.')
  return result.result
}
const selectedAccount = (): Address | undefined => {
  try { const selected = localStorage.getItem('dass.localAccount'); return selected && /^0x[0-9a-fA-F]{40}$/.test(selected) ? selected as Address : undefined } catch { return undefined }
}
export async function localAccounts(): Promise<Address[]> { return await localRPC('eth_accounts') as Address[] }
export async function selectLocalAccount(account: Address): Promise<void> {
  const available = await localAccounts()
  if (!available.some(item => item.toLowerCase() === account.toLowerCase())) throw new Error('The selected account is not an unlocked local demo account.')
  localStorage.setItem('dass.localAccount', account)
  handlers.get('accountsChanged')?.forEach(handler => handler([account]))
}
export const localProvider = {
  async request({ method, params = [] }: { method: string; params?: readonly unknown[] }) {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
      const selected = selectedAccount()
      if (selected) return [selected]
      if (method === 'eth_requestAccounts') { const available = await localAccounts(); if (available[0]) { await selectLocalAccount(available[0]); return [available[0]] } }
      return []
    }
    if (method === 'wallet_switchEthereumChain') {
      const target = (params[0] as { chainId: string }).chainId
      if (Number(target) !== deployment.chainId) throw new Error('The local demo cannot switch to another network.')
      return null
    }
    if (method === 'eth_sendTransaction') {
      const selected = selectedAccount(), tx = params[0] as { from?: string }
      if (!selected || tx.from?.toLowerCase() !== selected.toLowerCase()) throw new Error('Select a disposable local account before sending.')
    }
    if (!['eth_chainId', 'eth_sendTransaction', 'eth_getTransactionCount', 'eth_estimateGas', 'eth_gasPrice', 'eth_getBlockByNumber', 'eth_maxPriorityFeePerGas', 'eth_feeHistory'].includes(method)) throw new Error(`Local demo wallet does not support ${method}.`)
    return localRPC(method, params)
  },
  on(event: string, handler: (...args: unknown[]) => void) { const list = handlers.get(event) ?? new Set(); list.add(handler); handlers.set(event, list) },
  removeListener(event: string, handler: (...args: unknown[]) => void) { handlers.get(event)?.delete(handler) },
} as EIP1193Provider & { on: (event: string, handler: (...args: unknown[]) => void) => void; removeListener: (event: string, handler: (...args: unknown[]) => void) => void }
