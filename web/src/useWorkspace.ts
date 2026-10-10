import { useCallback, useEffect, useRef, useState } from 'react'
import { decodeEventLog, type Address, type Hash } from 'viem'
import { distributionMarketsAbi } from './contracts'
import { balances, chain, connectWallet, contractAddress, injectedWallet, prepareCall, publicClient, readContract, readMarkets, readPositions, reconcileTransaction, sendPrepared, switchNetwork, walletProvider } from './chain'
import { errorMessage, loadTransactions, pendingFor, saveTransactions, transactionContext } from './transactions'
import type { Market, Position, TransactionRecord } from './types'

export function useWorkspace() {
  const [account, setAccount] = useState<Address>(), [walletChainId, setWalletChainId] = useState<number>()
  const [markets, setMarkets] = useState<Market[]>([]), [positions, setPositions] = useState<Position[]>([])
  const [operator, setOperator] = useState<Address>(), [sponsorPayouts, setSponsorPayouts] = useState<Record<string, bigint>>({})
  const [funds, setFunds] = useState<{ native: bigint; token: bigint; allowance: bigint }>()
  const [transactions, setTransactions] = useState<TransactionRecord[]>(loadTransactions)
  const transactionRef = useRef(transactions), [busy, setBusy] = useState(false), [loading, setLoading] = useState(Boolean(contractAddress))
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [timestamp, setTimestamp] = useState(BigInt(Math.floor(Date.now() / 1000)))
  const refreshRunning = useRef(false)
  const queuedRefresh = useRef<(() => Promise<void>) | undefined>(undefined)
  const updateTransactions = useCallback((records: TransactionRecord[]) => { transactionRef.current = records; setTransactions(records); saveTransactions(records) }, [])
  const refresh = useCallback(async () => {
    if (!contractAddress) return
    if (refreshRunning.current) { queuedRefresh.current = refresh; return }
    refreshRunning.current = true
    try {
      const block = await publicClient.getBlock()
      if (await publicClient.getChainId() !== chain.id) throw new Error('RPC chain does not match the deployment manifest.')
      const nextMarkets = await readMarkets(block.number)
      setMarkets(nextMarkets); setTimestamp(block.timestamp)
      setOperator(await readContract('operator', [], block.number) as Address)
      if (account) {
        const [owned, nextFunds] = await Promise.all([readPositions(account, block.number), balances(account)])
        setPositions(owned); setFunds(nextFunds)
        const payouts = await Promise.all(nextMarkets.filter(item => item.status !== 0 && !item.sponsorClaimed && item.sponsor.toLowerCase() === account.toLowerCase()).map(async item => [item.id.toString(), await readContract('previewSponsorClaim', [item.id], block.number) as bigint] as const))
        setSponsorPayouts(Object.fromEntries(payouts))
      } else { setPositions([]); setFunds(undefined); setSponsorPayouts({}) }
      setError('')
    } catch (failure) { setError(errorMessage(failure)) }
    finally {
      refreshRunning.current = false; setLoading(false)
      const next = queuedRefresh.current; queuedRefresh.current = undefined
      if (next) void next()
    }
  }, [account])

  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15000); return () => clearInterval(timer) }, [refresh])
  useEffect(() => {
    const provider = walletProvider()
    if (!provider) return
    const changeAccounts = (...args: unknown[]) => { const accounts = args[0] as Address[]; setAccount(accounts[0]); setNotice('Wallet account changed. Review any draft again before submitting.'); setFunds(undefined); setPositions([]) }
    const changeChain = (...args: unknown[]) => { setWalletChainId(Number(args[0])); setNotice('Wallet network changed. Review any draft again before submitting.') }
    provider.on?.('accountsChanged', changeAccounts); provider.on?.('chainChanged', changeChain)
    // Only read already-authorized accounts; opening the page never prompts the wallet.
    void injectedWallet().getAddresses().then(async accounts => { setAccount(accounts[0]); setWalletChainId(await injectedWallet().getChainId()) }).catch(() => {})
    return () => { provider.removeListener?.('accountsChanged', changeAccounts); provider.removeListener?.('chainChanged', changeChain) }
  }, [])

  const reconcile = useCallback(async () => {
    const current = transactionRef.current
    const next = await Promise.all(current.map(item => ['pending', 'unknown'].includes(item.state) ? reconcileTransaction(item) : item))
    updateTransactions(next); await refresh()
  }, [refresh, updateTransactions])
  useEffect(() => { void reconcile() }, [reconcile])
  useEffect(() => {
    if (!transactions.some(item => ['pending', 'unknown'].includes(item.state) && item.chainId === chain.id)) return
    const timer = setInterval(() => void reconcile(), 12000)
    return () => clearInterval(timer)
  }, [transactions, reconcile])

  const connect = async () => { try { const result = await connectWallet(); setAccount(result.account); setWalletChainId(result.walletChainId); setError('') } catch (failure) { setError(errorMessage(failure)) } }
  const switchChain = async () => { try { await switchNetwork(); setWalletChainId(await injectedWallet().getChainId()); setError('') } catch (failure) { setError(errorMessage(failure)) } }
  const pending = pendingFor(transactions, account, chain.id)
  const wrongNetwork = Boolean(account && walletChainId !== chain.id)
  const submitRequest = async (action: string, request: Parameters<typeof sendPrepared>[0], marketId?: bigint, receiptId?: bigint): Promise<TransactionRecord | undefined> => {
    if (!account || wrongNetwork || pending || busy) throw new Error('Connect to the configured network and reconcile any outstanding transaction before sending another.')
    setBusy(true); setError(''); setNotice('Confirm the transaction in your wallet.')
    try {
      const hash: Hash = await sendPrepared(request)
      const item: TransactionRecord = { id: `${chain.id}:${hash}`, hash, chainId: chain.id, deploymentContext: transactionContext, account, action, marketId: marketId?.toString(), receiptId: receiptId?.toString(), createdAt: Date.now(), state: 'pending' }
      updateTransactions([...transactionRef.current, item]); setNotice('Transaction submitted. Waiting for confirmation; do not submit a duplicate.')
      let settled: TransactionRecord
      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90000 })
        settled = { ...item, state: receipt.status === 'success' ? 'confirmed' : 'reverted', blockNumber: receipt.blockNumber.toString() }
        for (const log of receipt.logs) {
          if (log.address.toLowerCase() !== contractAddress?.toLowerCase()) continue
          try {
            const event = decodeEventLog({ abi: distributionMarketsAbi, data: log.data, topics: log.topics })
            if (event.eventName === 'CurveChanged') settled.receiptId = event.args.receiptId.toString()
            if (event.eventName === 'MarketCreated') settled.marketId = event.args.marketId.toString()
          } catch { /* Other dapp logs are reconciled using authoritative record getters. */ }
        }
      } catch { settled = { ...item, state: 'unknown' } }
      updateTransactions(transactionRef.current.map(value => value.id === item.id ? settled : value))
      if (settled.state === 'confirmed') { setNotice(`${action} confirmed${settled.receiptId ? ` · receipt #${settled.receiptId}` : settled.marketId ? ` · market #${settled.marketId}` : ''}. Onchain records have been refreshed.`); await refresh() }
      else if (settled.state === 'reverted') setError(`${action} reverted onchain. No state change from that transaction was applied; the network fee may still be charged.`)
      else setNotice('Transaction status is unknown. Reconcile the hash before taking another action; a timeout does not establish failure.')
      return settled
    } catch (failure) { setError(errorMessage(failure)); setNotice(''); return undefined }
    finally { setBusy(false) }
  }
  const execute = async (action: string, functionName: string, args: readonly unknown[], deposit = 0n, marketId?: bigint, receiptId?: bigint) => {
    if (!account) { setError('Connect your wallet first.'); return }
    try { const prepared = await prepareCall(account, functionName, args, deposit); return await submitRequest(action, prepared.request, marketId, receiptId) }
    catch (failure) { setError(errorMessage(failure)); return undefined }
  }
  return { account, walletChainId, markets, positions, operator, sponsorPayouts, funds, transactions, busy, loading, error, notice, timestamp, pending, wrongNetwork, refresh, reconcile, connect, switchChain, execute, submitRequest, setError, setNotice }
}
export type Workspace = ReturnType<typeof useWorkspace>
