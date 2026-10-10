import {
  createPublicClient, createWalletClient, custom, defineChain, erc20Abi, fallback, http,
  isAddress, formatUnits, type Abi, type Address, type EIP1193Provider, type Hash, type WriteContractParameters,
} from 'viem'
import { deployment, distributionMarketsAbi } from './contracts'
import type { Curve, Market, Position, TransactionRecord } from './types'
import { localDemoEnabled, localProvider } from './localWallet'

export const chain = defineChain({
  id: deployment.chainId, name: String(deployment.status) === 'local' ? 'Local Arc' : deployment.chainId === 5042002 ? 'Arc Testnet' : deployment.chainId === 5042 ? 'Arc Mainnet' : 'Configured development network',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [deployment.rpcUrl] } },
  blockExplorers: { default: { name: 'Explorer', url: deployment.explorerUrl } },
})
// Pace reads and retry explicit public-RPC throttling. This transport never signs transactions.
const rpcTransport: ReturnType<typeof fallback> = options => {
  // Circle's arc-node guide lists this endpoint; chain ID, deployed bytecode and logs are verified in evidence.
  const secondary = chain.id === 5042002 && String(deployment.status) === 'deployed' ? [http('https://rpc.blockdaemon.testnet.arc.io', { timeout: 8000, retryCount: 0 })] : []
  const transport = fallback([http(deployment.rpcUrl, { timeout: 8000, retryCount: 0 }), ...secondary], { retryCount: 0 })(options)
  let queue: Promise<unknown> = Promise.resolve(), nextRequest = 0
  return { ...transport, request: ((request: Parameters<typeof transport.request>[0]) => {
    const task = queue.then(async () => {
      for (let attempt = 0; ; attempt++) {
        const wait = nextRequest - Date.now()
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
        nextRequest = Date.now() + 350
        try { return await transport.request(request) }
        catch (failure) {
          const error = failure as { code?: number; status?: number; message?: string; cause?: { code?: number; status?: number } }
          const limited = error.code === -32005 || error.cause?.code === -32005 || error.status === 429 || error.cause?.status === 429 || /rate limit|exceeds defined limit/i.test(error.message ?? '')
          if (!limited || attempt >= 2) throw failure
          await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt))
        }
      }
    })
    queue = task.catch(() => {})
    return task
  }) as typeof transport.request }
}
export const publicClient = createPublicClient({ chain, transport: rpcTransport, pollingInterval: 4000 })
export const contractAddress = deployment.address && isAddress(deployment.address) ? deployment.address as Address : undefined
export const tokenAddress = deployment.tokenAddress as Address
const abi: Abi = distributionMarketsAbi
const WAD = 10n ** 18n

declare global { interface Window { ethereum?: EIP1193Provider & { on?: (event: string, handler: (...args: unknown[]) => void) => void; removeListener?: (event: string, handler: (...args: unknown[]) => void) => void } } }
export function injectedWallet() {
  const provider = walletProvider()
  if (!provider) throw new Error('No injected EVM wallet found. Install a wallet that supports custom networks, then connect.')
  return createWalletClient({ chain, transport: custom(provider) })
}
export function walletProvider() { return localDemoEnabled() ? localProvider : window.ethereum }
export async function connectWallet(): Promise<{ account: Address; walletChainId: number }> {
  const wallet = injectedWallet()
  const accounts = await wallet.requestAddresses()
  if (!accounts[0]) throw new Error('The wallet did not provide an account.')
  return { account: accounts[0], walletChainId: await wallet.getChainId() }
}
export async function switchNetwork(): Promise<void> {
  const wallet = injectedWallet()
  try { await wallet.switchChain({ id: chain.id }) }
  catch (error) {
    const code = (error as { code?: number; cause?: { code?: number } }).code ?? (error as { cause?: { code?: number } }).cause?.code
    if (code !== 4902) throw error
    await wallet.addChain({ chain })
    await wallet.switchChain({ id: chain.id })
  }
}
function addressRequired(): Address { if (!contractAddress) throw new Error('No verified deployment configured. This workspace is read-only.'); return contractAddress }
export async function readContract(functionName: string, args: readonly unknown[] = [], blockNumber?: bigint): Promise<unknown> {
  return publicClient.readContract({ address: addressRequired(), abi, functionName, args, blockNumber })
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('Contract returned an invalid record. Regenerate the frontend ABI from the deployment artifacts.')
  return value as Record<string, unknown>
}
function integer(value: unknown, name: string): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
  throw new Error(`Contract record is missing ${name}. Regenerate the ABI; do not substitute a cached value.`)
}
function curve(value: unknown): Curve { const item = record(value); return { mean: integer(item.mean, 'mean'), sigma: integer(item.sigma, 'sigma') } }
export async function readMarket(id: bigint, blockNumber?: bigint): Promise<Market> {
  const item = record(await readContract('getMarket', [id], blockNumber))
  return {
    ...item, id, sponsor: item.sponsor as Address, resolver: item.resolver as Address,
    rulesHash: item.rulesHash as Hash, rulesURI: item.rulesURI as string, units: item.units as string,
    origin: integer(item.origin, 'origin'), scale: integer(item.scale, 'scale'), outcomeStep: integer(item.outcomeStep, 'outcomeStep'),
    backing: integer(item.backing, 'backing'), k: integer(item.k, 'k'),
    initialCurve: curve(item.initialCurve), currentCurve: curve(item.currentCurve),
    minMean: integer(item.minMean, 'minMean'), maxMean: integer(item.maxMean, 'maxMean'),
    minSigma: integer(item.minSigma, 'minSigma'), maxSigma: integer(item.maxSigma, 'maxSigma'),
    minOutcome: integer(item.minOutcome, 'minOutcome'), maxOutcome: integer(item.maxOutcome, 'maxOutcome'),
    closeAt: integer(item.closeAt, 'closeAt'), resolveBy: integer(item.resolveBy, 'resolveBy'),
    nonce: integer(item.nonce, 'nonce'), status: Number(item.status), outcome: integer(item.outcome, 'outcome'),
    deposited: integer(item.deposited, 'deposited'), paid: integer(item.paid, 'paid'),
    sponsorClaimed: Boolean(item.sponsorClaimed), evidenceHash: item.evidenceHash as Hash,
  }
}

type EventRecord = { args: Record<string, unknown>; transactionHash: Hash; logIndex: number; blockNumber: bigint }
const eventHistory = new Map<string, { next: bigint; records: Map<string, EventRecord>; running?: Promise<void> }>()
/** Scan each confirmed range once; share concurrent scans and advance only after successful reads. */
async function eventLogs(eventName: string, toBlock: bigint) {
  let history = eventHistory.get(eventName)
  if (!history) { history = { next: BigInt(deployment.deploymentBlock ?? 0), records: new Map() }; eventHistory.set(eventName, history) }
  if (history.running) await history.running
  if (history.next > toBlock) return [...history.records.values()].filter(log => log.blockNumber <= toBlock)
  const current = history
  current.running = (async () => {
    while (current.next <= toBlock) {
      const end = current.next + 4999n < toBlock ? current.next + 4999n : toBlock
      const logs = await publicClient.getContractEvents({ address: addressRequired(), abi, eventName, fromBlock: current.next, toBlock: end })
      for (const log of logs) {
        if (log.transactionHash === null || log.logIndex === null || log.blockNumber === null) continue
        current.records.set(`${log.transactionHash}:${log.logIndex}`, { args: (log as unknown as { args: Record<string, unknown> }).args, transactionHash: log.transactionHash, logIndex: log.logIndex, blockNumber: log.blockNumber })
      }
      current.next = end + 1n
    }
  })()
  try { await current.running } finally { current.running = undefined }
  return [...current.records.values()].filter(log => log.blockNumber <= toBlock)
}
export async function readMarkets(blockNumber: bigint): Promise<Market[]> {
  // IDs are contiguous and immutable; the contract's counter avoids a discovery history scan.
  const count = integer(await readContract('marketCount', [], blockNumber), 'marketCount')
  const markets: Market[] = []
  for (let start = 1n; start <= count; start += 20n) {
    const ids: bigint[] = []
    for (let id = start; id <= count && id < start + 20n; id++) ids.push(id)
    markets.push(...await Promise.all(ids.map(id => readMarket(id, blockNumber))))
  }
  return markets.reverse()
}
export async function readForecastEvents(marketId: bigint) {
  const blockNumber = await publicClient.getBlockNumber()
  const logs = await eventLogs('CurveChanged', blockNumber)
  return logs.filter(log => integer(log.args.marketId, 'marketId') === marketId).slice(-20).reverse().map(log => ({ hash: log.transactionHash, owner: log.args.owner as Address, receiptId: integer(log.args.receiptId, 'receiptId'), deposit: integer(log.args.deposit, 'deposit') }))
}
export async function readPositions(account: Address, blockNumber: bigint): Promise<Position[]> {
  const [logs, claims] = await Promise.all([eventLogs('CurveChanged', blockNumber), eventLogs('PositionClaimed', blockNumber)])
  const claimedAmounts = new Map(claims.map(log => [integer(log.args.receiptId, 'receiptId'), integer(log.args.amount, 'amount')]))
  const ids = [...new Set(logs.filter(log => String(log.args.owner).toLowerCase() === account.toLowerCase()).map(log => integer(log.args.receiptId, 'receiptId')))]
  return Promise.all(ids.reverse().map(async id => {
    const item = record(await readContract('getReceipt', [id], blockNumber))
    const marketId = integer(item.marketId, 'marketId'), market = await readMarket(marketId, blockNumber)
    const payout = item.claimed ? claimedAmounts.get(id) ?? 0n : market.status !== 0 ? await readContract('previewClaim', [id], blockNumber) as bigint : 0n
    return { id, owner: item.owner as Address, marketId, oldCurve: curve(item.oldCurve), newCurve: curve(item.newCurve), deposit: integer(item.deposit, 'deposit'), claimed: Boolean(item.claimed), payout, claimable: market.status !== 0 && !item.claimed }
  }))
}
export async function verifyNetwork(account: Address): Promise<void> {
  const [rpcChainId, walletChainId, decimals, actualToken, code] = await Promise.all([
    publicClient.getChainId(), injectedWallet().getChainId(),
    publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'decimals' }),
    readContract('token'), publicClient.getBytecode({ address: addressRequired() }),
  ])
  if (rpcChainId !== chain.id || walletChainId !== chain.id) throw new Error(`Switch your wallet to ${chain.name}. RPC and wallet chain IDs must both equal ${chain.id}.`)
  if (decimals !== 6 || String(actualToken).toLowerCase() !== tokenAddress.toLowerCase() || !code || code === '0x') throw new Error('Deployment verification failed: token decimals, token address, or contract bytecode do not match the manifest.')
  const accounts = await injectedWallet().getAddresses()
  if (!accounts.some(value => value.toLowerCase() === account.toLowerCase())) throw new Error('The connected wallet account changed. Connect and review again.')
}
export async function balances(account: Address) {
  const [native, token, allowance] = await Promise.all([
    publicClient.getBalance({ address: account }),
    publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
    publicClient.readContract({ address: tokenAddress, abi: erc20Abi, functionName: 'allowance', args: [account, addressRequired()] }),
  ])
  return { native, token, allowance }
}
export async function prepareCall(account: Address, functionName: string, args: readonly unknown[], deposit = 0n) {
  await verifyNetwork(account)
  const [simulation, fee, balance] = await Promise.all([
    publicClient.simulateContract({ address: addressRequired(), abi, functionName, args, account }),
    publicClient.estimateFeesPerGas(), balances(account),
  ])
  const gas = await publicClient.estimateContractGas({ address: addressRequired(), abi, functionName, args, account })
  const gasReserve = (gas * (fee.maxFeePerGas ?? fee.gasPrice ?? 0n) * 120n + 99n) / 100n
  if (balance.token < deposit || balance.native < deposit * 10n ** 12n + gasReserve) throw new Error(`Insufficient shared USDC balance for the ${Number(deposit) / 1e6} USDC deposit plus the fee reserve. Deposit units use 6 decimals; gas units use 18 decimals.`)
  return { request: simulation.request, gasReserve, gas, nonce: await publicClient.getTransactionCount({ address: account, blockTag: 'pending' }) }
}
export async function prepareApproval(account: Address, amount: bigint) {
  await verifyNetwork(account)
  const args = [addressRequired(), amount] as const
  const [simulation, gas, fee, balance] = await Promise.all([
    publicClient.simulateContract({ account, address: tokenAddress, abi: erc20Abi, functionName: 'approve', args }),
    publicClient.estimateContractGas({ account, address: tokenAddress, abi: erc20Abi, functionName: 'approve', args }),
    publicClient.estimateFeesPerGas(), balances(account),
  ])
  // A provisional trade reserve is replaced with the actual estimate after approval.
  const gasReserve = ((gas + 700000n) * (fee.maxFeePerGas ?? fee.gasPrice ?? 0n) * 120n + 99n) / 100n
  if (balance.token < amount || balance.native < amount * 10n ** 12n + gasReserve) throw new Error(`Not enough shared USDC for collateral and transaction fees. ${chain.id === 5042002 ? 'Add Arc Testnet USDC from the Circle faucet.' : 'Fund your wallet with USDC on Arc Mainnet.'}`)
  return { request: simulation.request, gasReserve }
}
export type PreparedRequest = { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; account?: unknown; [key: string]: unknown }
export async function sendPrepared(request: PreparedRequest): Promise<Hash> {
  // The generic contract adapter is runtime checked by simulateContract before this boundary.
  return injectedWallet().writeContract(request as WriteContractParameters)
}
export async function reconcileTransaction(item: TransactionRecord): Promise<TransactionRecord> {
  if (item.chainId !== chain.id) return item
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: item.hash })
    return { ...item, state: receipt.status === 'success' ? 'confirmed' : 'reverted', blockNumber: receipt.blockNumber.toString() }
  } catch { return { ...item, state: 'unknown' } }
}
export function coordinate(value: string): bigint {
  if (!/^-?\d+(\.\d{1,18})?$/.test(value)) throw new Error('Enter a decimal with no more than 18 places.')
  const negative = value.startsWith('-'), [whole, fraction = ''] = value.replace('-', '').split('.')
  return (BigInt(whole) * WAD + BigInt(fraction.padEnd(18, '0'))) * (negative ? -1n : 1n)
}
export function formatCoordinate(value: bigint): string { return formatUnits(value, 18) }
