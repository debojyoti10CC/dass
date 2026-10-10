#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = process.env.ARC_LOCAL_PORT || '8547';
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('ARC_LOCAL_PORT must be between 1024 and 65535');
const binary = join(root, 'work', 'arc-foundry', 'anvil');
if (!existsSync(binary)) throw new Error('Arc Foundry is missing. Run node scripts/install-arc-tools.mjs first.');
const args = ['--network', 'arc', '--chain-id', '5042002', '--host', '127.0.0.1', '--port', port, '--quiet', '--cache-path', './work/arc-anvil-cache'];
let command = binary;
if (process.platform === 'win32') {
  const linuxRoot = root.replace(/\\/g, '/').replace(/^([a-z]):/i, (_, drive) => `/mnt/${drive.toLowerCase()}`);
  command = 'wsl.exe';
  args.unshift('-d', process.env.ARC_WSL_DISTRO || 'Ubuntu', '--cd', linuxRoot, '--exec', './work/arc-foundry/anvil');
}
console.log(`Starting disposable local Arc runtime at http://127.0.0.1:${port}. Stop with Ctrl+C. Never fund these development accounts on a public network.`);
const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
child.on('error', (error) => { console.error(`Arc runtime failed to start: ${error.message}`); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
