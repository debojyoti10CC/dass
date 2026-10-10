import { deployment } from './contracts'

export function ExplorerLink({ type, value, full = false }: { type: 'tx' | 'address'; value: string; full?: boolean }) {
  const label = full ? value : `${value.slice(0, 6)}…${value.slice(-4)}`
  return deployment.explorerUrl ? <a href={`${deployment.explorerUrl}/${type}/${value}`} target="_blank" rel="noreferrer" title={value}>{label} ↗</a> : <span className="number" title={value}>{label}</span>
}
