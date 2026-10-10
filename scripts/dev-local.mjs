import { spawn } from 'node:child_process';
import { compile } from './compile.mjs';
process.env.DASS_DEPLOYMENT = 'local';
compile();
const child = spawn(process.execPath, ['../node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { cwd: 'web', stdio: 'inherit', env: process.env });
child.on('exit', code => process.exit(code ?? 1));
