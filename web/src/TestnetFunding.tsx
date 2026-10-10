import { useEffect, useRef, useState } from 'react'
import { chain, publicClient } from './chain'
import { deployment } from './contracts'
import { localDemoEnabled } from './localWallet'
import { nativeUSDC } from './math'
import { errorMessage } from './transactions'
import type { Workspace } from './useWorkspace'

export function TestnetFunding({ workspace }: { workspace: Workspace }) {
  if (chain.id !== 5042002 || String(deployment.status) !== 'deployed' || localDemoEnabled()) return null
  return <FundingDialog workspace={workspace} />
}

function FundingDialog({ workspace }: { workspace: Workspace }) {
  const dialog = useRef<HTMLDialogElement>(null), request = useRef(0)
  const [open, setOpen] = useState(false), [copied, setCopied] = useState(false)
  const [balance, setBalance] = useState<{ account: string; amount: bigint }>()
  const [checking, setChecking] = useState(false), [error, setError] = useState(''), [checked, setChecked] = useState(false)
  const account = workspace.account

  async function refreshBalance() {
    if (!account) return
    const attempt = ++request.current
    let timer: ReturnType<typeof setTimeout> | undefined
    setChecking(true); setError(''); setChecked(false)
    try {
      const amount = await Promise.race([publicClient.getBalance({ address: account }), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Balance check timed out. Try Refresh balance again.')), 25000)
      })])
      if (attempt === request.current) { setBalance({ account, amount }); setChecked(true) }
    } catch (failure) { if (attempt === request.current) setError(errorMessage(failure)) }
    finally { clearTimeout(timer); if (attempt === request.current) setChecking(false) }
  }

  useEffect(() => {
    setCopied(false); setBalance(undefined); setError(''); setChecked(false); setChecking(false)
    if (open && account) void refreshBalance()
    return () => { request.current++ }
  }, [open, account])

  async function copyAddress() {
    if (!account) return
    setError('')
    try { await navigator.clipboard.writeText(account); setCopied(true) }
    catch { setError('Copy is unavailable. Select and copy the wallet address below.') }
  }

  return <>
    <button className="secondary fund-wallet-button" onClick={() => { dialog.current?.showModal(); setOpen(true) }}>Fund test wallet</button>
    <dialog ref={dialog} className="funding-dialog" aria-labelledby="funding-title" aria-describedby="funding-description" onClose={() => setOpen(false)}>
      <div className="funding-heading"><span className="badge">ARC TESTNET</span><button className="funding-close" aria-label="Close funding panel" onClick={() => dialog.current?.close()}>×</button></div>
      <h2 id="funding-title">Fund your test wallet.</h2>
      <p id="funding-description" className="muted">Get free test USDC for forecasts and transaction fees. On Arc, the same USDC balance covers both.</p>
      {account ? <>
        <div className="funding-balance"><span>Test USDC balance</span><strong>{balance?.account === account ? `${nativeUSDC(balance.amount)} USDC` : checking ? 'Checking…' : 'Not checked'}</strong><small>Keep some USDC for gas when depositing collateral.</small></div>
        <label className="funding-address">Your connected wallet<input aria-label="Connected wallet address" readOnly value={account} onFocus={event => event.currentTarget.select()} /></label>
        <button className="text-button" onClick={() => void copyAddress()}>{copied ? 'Address copied ✓' : 'Copy wallet address'}</button>
        {workspace.wrongNetwork && <div className="funding-connect"><p>Your wallet is on another network. Faucet funds arrive on <strong>Arc Testnet</strong>.</p><button className="secondary" onClick={() => void workspace.switchChain()}>Switch to Arc Testnet</button></div>}
        <ol className="funding-steps"><li>Copy your wallet address.</li><li>Open Circle’s faucet. Select <strong>USDC</strong> and <strong>Arc Testnet</strong>, paste your address, and submit.</li><li>Return here and refresh your balance.</li></ol>
      </> : <div className="funding-connect"><p>Connect your wallet to copy its address and check your test USDC balance.</p><button className="secondary" onClick={() => void workspace.connect()}>Connect wallet</button>{workspace.error && <p className="inline-error" role="alert">{workspace.error}</p>}</div>}
      <a className="primary full-width funding-faucet" href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer">Open Circle faucet <span aria-hidden="true">↗</span></a>
      {account && <button className="secondary full-width funding-refresh" disabled={checking} onClick={() => void refreshBalance()}>{checking ? 'Checking balance…' : 'Refresh balance'}</button>}
      {checked && <p className="funding-status" role="status">Balance refreshed from Arc Testnet. If funding is still pending, check again shortly.</p>}
      {copied && <span className="sr-only" role="status">Wallet address copied.</span>}
      {error && <p className="inline-error funding-status" role="alert">{error}</p>}
      <p className="fine-print funding-limit">Circle currently offers 20 test USDC every 2 hours per address and network. Complete any CAPTCHA on its page. Test tokens have no real monetary value.</p>
    </dialog>
  </>
}
