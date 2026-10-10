#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const forge = join(root, 'work', 'arc-foundry', 'forge');
const compiler = join(root, 'work', 'solc', 'solc-0.8.30');
if (!existsSync(forge) || !existsSync(compiler)) throw new Error('Project-local Arc tools/compiler are missing. Run npm run tools:arc first.');
const rpc = process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8547';
const parsed = new URL(rpc);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('Arc test runner requires a disposable local RPC URL. Start npm run node:arc.');
const args = ['test', '--network', 'arc', '--use', '../work/solc/solc-0.8.30', '--offline', '--fork-url', rpc, '--no-storage-caching', '-vv'];
let command = forge;
let cwd = join(root, 'contracts');
if (process.platform === 'win32') {
  const linuxRoot = root.replace(/\\/g, '/').replace(/^([a-z]):/i, (_, drive) => `/mnt/${drive.toLowerCase()}`);
  command = 'wsl.exe';
  args.unshift('-d', process.env.ARC_WSL_DISTRO || 'Ubuntu', '--cd', `${linuxRoot}/contracts`, '--exec', '../work/arc-foundry/forge');
}
const child = spawn(command, args, { cwd, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true });
let output = '';
child.stdout.on('data', (chunk) => { output += chunk.toString(); process.stdout.write(chunk); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); process.stderr.write(chunk); });
child.on('error', (error) => { console.error(`Arc tests failed to start: ${error.message}`); process.exitCode = 1; });
child.on('close', async (code) => {
  await mkdir(join(root, 'work'), { recursive: true });
  await writeFile(join(root, 'work', 'arc-forge-tests.log'), output, 'utf8');
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
