import { spawn } from 'node:child_process';
import fs from 'node:fs';

let node;
async function ready() {
  try {
    const response = await fetch('http://127.0.0.1:8547', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }), signal: AbortSignal.timeout(1000) });
    return Number(BigInt((await response.json()).result)) === 5042002;
  } catch { return false; }
}
function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${script} failed (${code})`)));
  });
}
if (!await ready()) {
  if (!fs.existsSync('work/arc-foundry/anvil')) await run('scripts/install-arc-tools.mjs');
  node = spawn(process.execPath, ['scripts/arc-node.mjs'], { stdio: 'inherit', windowsHide: true });
  let available = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await ready()) { available = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!available) { node.kill(); throw new Error('Local Arc runtime did not become ready. Check WSL Ubuntu/GLIBC requirements in docs/arc-integration.md'); }
}
await run('scripts/seed-local.mjs');
const web = spawn(process.execPath, ['scripts/dev-local.mjs'], { stdio: 'inherit', windowsHide: true });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { web.kill(signal); node?.kill(signal); });
web.on('exit', code => { node?.kill(); process.exitCode = code ?? 0; });
