#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = 'v0.8.0-2';
const platform = process.platform === 'win32' ? 'linux' : process.platform;
const arch = process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : '';
const target = platform === 'linux' && arch ? `${arch}-unknown-linux-gnu` : platform === 'darwin' && arch === 'aarch64' ? 'aarch64-apple-darwin' : '';
if (!target) throw new Error('Official Arc Foundry binaries support Linux x64/arm64, macOS arm64, and Windows through WSL.');
const file = `arc-foundry-${version}-${target}.tar.gz`;
const directory = join(root, 'work', 'arc-foundry');
await mkdir(directory, { recursive: true });
async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
const release = `https://github.com/circlefin/arc-foundry/releases/download/${version}/${file}`;
const [archive, checksum] = await Promise.all([download(release), download(`${release}.sha256`)]);
const expected = checksum.toString('utf8').trim().split(/\s/)[0].toLowerCase();
const actual = createHash('sha256').update(archive).digest('hex');
if (actual !== expected) throw new Error('Arc Foundry archive checksum mismatch');
await writeFile(join(directory, file), archive);
await writeFile(join(directory, `${file}.sha256`), checksum);
console.log(`Verified Arc Foundry ${version} SHA256 ${actual}`);
const distro = process.env.ARC_WSL_DISTRO || 'Ubuntu';
const linuxRoot = root.replace(/\\/g, '/').replace(/^([a-z]):/i, (_, drive) => `/mnt/${drive.toLowerCase()}`);
if (process.platform === 'win32') await run('wsl.exe', ['-d', distro, '--cd', `${linuxRoot}/work/arc-foundry`, '--exec', 'tar', '-xzf', file]);
else await run('tar', ['-xzf', file], directory);
if ((platform === 'linux' && arch === 'x86_64') || platform === 'darwin') {
  const compilerPlatform = platform === 'darwin' ? 'macosx-amd64' : 'linux-amd64';
  const solc = await download(`https://binaries.soliditylang.org/${compilerPlatform}/solc-${compilerPlatform}-v0.8.30+commit.73712a01`);
  const expectedSolc = platform === 'darwin' ? '738dcdc6afddeb505ee4e4ef24f1c1fdba2b8c924e614cbbf5801a5b062dd683' : 'f3e987dc6ecebd4bd350c48edcbc320b46cf9e3109bd3fc3d88f1acaf4c428f7';
  if (createHash('sha256').update(solc).digest('hex') !== expectedSolc) throw new Error('Solidity compiler checksum mismatch');
  await mkdir(join(root, 'work', 'solc'), { recursive: true });
  await writeFile(join(root, 'work', 'solc', 'solc-0.8.30'), solc, { mode: 0o755 });
  if (process.platform === 'win32') await run('wsl.exe', ['-d', distro, '--cd', linuxRoot, '--exec', 'chmod', '+x', './work/solc/solc-0.8.30']);
  console.log('Verified project-local Solidity 0.8.30 compiler.');
}
if (process.platform === 'win32') await run('wsl.exe', ['-d', distro, '--cd', linuxRoot, '--exec', './work/arc-foundry/forge', '--version']);
else await run(join(directory, 'forge'), ['--version']);
console.log('Installed under project work/ only. Ubuntu 24.04 or newer is required by the Linux binary GLIBC dependency.');
