// Starts Opt Out on this computer with the built-in test mailbox, no terminal commands needed.
// Added to the pre-release download by build-private.ps1; run it with "Start Opt Out.cmd".
// First run: creates server/.env, installs packages and builds the web app (a few minutes).
// After that it starts in seconds. Close the window to stop it.
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';

// 8790, or the next free port if something else already uses it
const free = port => new Promise(resolve => {
  const probe = createServer().once('error', () => resolve(false)).listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
});
let PORT = Number(process.env.PORT) || 8790;
while (!(await free(PORT))) PORT++;
const [major] = process.versions.node.split('.').map(Number);
if (major < 24) {
  console.error(`Opt Out needs Node.js 24 or newer (this computer has ${process.versions.node}). Get it from https://nodejs.org`);
  process.exit(1);
}
process.chdir(import.meta.dirname);

const run = (step, command) => {
  console.log(`\n== ${step} ==`);
  if (spawnSync(command, { stdio: 'inherit', shell: true }).status) {
    console.error(`\n${step} failed. The messages above say why.`);
    process.exit(1);
  }
};

if (!existsSync('server/.env')) {
  console.log('First run: creating server/.env with the test mailbox switched on.');
  const env = readFileSync('server/.env.example', 'utf8')
    .replace(/^TOKEN_ENCRYPTION_KEY=.*$/m, `TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`)
    .replace(/^DEV_FAKE_PROVIDER=.*$/m, 'DEV_FAKE_PROVIDER=true');
  writeFileSync('server/.env', env);
}
if (!existsSync('node_modules')) run('Installing packages (first run only, a few minutes)', 'npm install --no-audit --no-fund');
if (!existsSync('web/dist')) run('Building the web app (first run only)', 'npm run build');

console.log(`\n== Starting Opt Out on http://localhost:${PORT} ==`);
console.log('On the sign-in page choose "Use development fixture mailbox". Close this window to stop Opt Out.\n');
// The server reads these before server/.env, so they win over the PORT in that file
const env = { ...process.env, PORT: String(PORT), APP_ORIGIN: `http://localhost:${PORT}` };
const server = spawn('npm start', { stdio: 'inherit', shell: true, env });
setTimeout(() => {
  const open = process.platform === 'win32' ? `start "" http://localhost:${PORT}` : process.platform === 'darwin' ? `open http://localhost:${PORT}` : `xdg-open http://localhost:${PORT}`;
  spawn(open, { shell: true, stdio: 'ignore' });
}, 4000);
server.on('exit', code => process.exit(code ?? 0));
