// Sets the username and password for the owner login, without the password ever being stored or shown.
//   npm run set-login             -> asks for both, then stores LOGIN_USER, PASSWORD_HASH and a fresh
//                                    SESSION_KEY as Worker secrets (this signs out every device)
//   npm run set-login -- --local  -> writes them to .dev.vars for `npm run dev` instead
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import readline from 'node:readline';

const ITERATIONS = 100_000; // the most Cloudflare Workers' PBKDF2 allows
const b64url = buf => buf.toString('base64url');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
// Piped input (tests): read every line up front, since rl.question would drop lines that arrive early
const piped = process.stdin.isTTY ? null : rl[Symbol.asyncIterator]();
let muted = false;
const write = rl._writeToOutput.bind(rl);
rl._writeToOutput = text => { if (!muted) write(text); }; // hides the password while it's typed

async function ask(question, hidden) {
  if (piped) return ((await piped.next()).value || '').trim();
  const answer = await new Promise(resolve => {
    rl.question(question, resolve);
    muted = hidden; // after the prompt is written, so the question itself still shows
  });
  if (hidden) { muted = false; process.stdout.write('\n'); }
  return answer.trim();
}

const user = (await ask('Username: ')).toLowerCase();
const password = await ask('Password (12+ characters): ', true);
const again = await ask('Password again: ', true);
rl.close();
if (!user) throw new Error('A username is needed.');
if (password.length < 12) throw new Error('Use at least 12 characters.');
if (password !== again) throw new Error("The passwords don't match.");

const salt = randomBytes(16);
const secrets = {
  LOGIN_USER: user,
  PASSWORD_HASH: `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(pbkdf2Sync(password, salt, ITERATIONS, 32, 'sha256'))}`,
  SESSION_KEY: b64url(randomBytes(32)),
};

if (process.argv.includes('--local')) {
  const keep = existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8').split(/\r?\n/).filter(l => l && !(l.split('=')[0] in secrets)) : [];
  writeFileSync('.dev.vars', [...keep, ...Object.entries(secrets).map(([k, v]) => `${k}=${v}`)].join('\n') + '\n');
  console.log('Saved to .dev.vars.');
} else {
  for (const [name, value] of Object.entries(secrets)) {
    const result = spawnSync(`npx wrangler secret put ${name}`, { input: value, stdio: ['pipe', 'inherit', 'inherit'], shell: true });
    if (result.status) throw new Error(`Setting ${name} failed.`);
  }
  console.log(`Done. Sign in as "${user}" on https://theconveniencesuite.com/private.html`);
}
