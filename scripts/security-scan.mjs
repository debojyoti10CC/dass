import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const file of ['work/slither-results.json', 'work/slither-results.sarif']) if (fs.existsSync(file)) fs.unlinkSync(file);
const options = ['contracts/src/DistributionMarkets.sol', '--compile-force-framework', 'solc', '--solc', 'work/solc/solc-0.8.30', '--solc-remaps', '@openzeppelin/=node_modules/@openzeppelin/ @prb/=node_modules/@prb/', '--solc-args', '--optimize --optimize-runs 200 --via-ir --evm-version paris', '--filter-paths', 'node_modules', '--exclude-dependencies', '--json', 'work/slither-results.json', '--sarif', 'work/slither-results.sarif', '--fail-none'];
let command = 'work/security-venv/bin/slither', args = options;
if (process.platform === 'win32') {
  const linuxRoot = root.replace(/\\/g, '/').replace(/^([a-z]):/i, (_, drive) => `/mnt/${drive.toLowerCase()}`);
  command = 'wsl.exe'; args = ['-d', process.env.ARC_WSL_DISTRO ?? 'Ubuntu', '--cd', linuxRoot, '--exec', 'work/security-venv/bin/slither', ...options];
}
const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', code => {
  fs.writeFileSync('work/slither-scan.log', output);
  if (code !== 0 || !fs.existsSync('work/slither-results.json')) { console.error(output.slice(-3000)); process.exitCode = 1; return; }
  const report = JSON.parse(fs.readFileSync('work/slither-results.json', 'utf8'));
  if (!report.success) { console.error(report.error); process.exitCode = 1; return; }
  const findings = report.results.detectors ?? [];
  console.log(JSON.stringify({ tool: 'Slither', version: '0.11.6', successfulAnalysis: true, findings: findings.map(item => ({ check: item.check, impact: item.impact, confidence: item.confidence, description: item.description })) }, null, 2));
});
