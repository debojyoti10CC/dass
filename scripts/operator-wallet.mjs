import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

function powershell(code, input) {
  try {
    return execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', code], {
      input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch { throw new Error('Windows credential protection failed. No signing material was logged.'); }
}
/** Private signing material stays in process memory and Windows CurrentUser DPAPI. */
export function operatorAccount({ create = false, role = 'operator' } = {}) {
  if (!['operator', 'trader-a', 'trader-b'].includes(role)) throw new Error('Unknown signer role.');
  const file = `.private/${role}-wallet.dpapi.json`;
  fs.mkdirSync('.private', { recursive: true });
  const previous = `work/${role}-wallet.dpapi.json`;
  if (!fs.existsSync(file) && fs.existsSync(previous)) fs.renameSync(previous, file);
  if (process.platform !== 'win32') throw new Error('This project-local signer uses Windows CurrentUser DPAPI. Use an external wallet on other hosts.');
  if (!fs.existsSync(file)) {
    if (!create) throw new Error('Run npm run wallet:operator first.');
    const key = generatePrivateKey(), account = privateKeyToAccount(key);
    const protectedKey = powershell('Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd().Trim()), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))', key);
    fs.writeFileSync(file, JSON.stringify({ address: account.address, protectedKey, protection: 'Windows DPAPI CurrentUser', createdAt: new Date().toISOString() }, null, 2));
  }
  const wallet = JSON.parse(fs.readFileSync(file, 'utf8'));
  const key = powershell('Add-Type -AssemblyName System.Security; [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))', wallet.protectedKey);
  const account = privateKeyToAccount(key);
  if (account.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Protected signer address does not match its public record.');
  return account;
}
if (process.argv[1]?.endsWith('operator-wallet.mjs')) {
  const role = process.argv.includes('--role') ? process.argv[process.argv.indexOf('--role') + 1] : 'operator';
  const account = operatorAccount({ create: true, role });
  const file = `.private/${role}-wallet.dpapi.json`;
  console.log(JSON.stringify({ address: account.address, protection: 'Windows DPAPI CurrentUser', file, note: 'Dedicated operator, separate from disposable local accounts. The encrypted file is Git-ignored and tied to this Windows login. Keep the file and Windows credential backup. Never send signing material in chat.' }, null, 2));
}
