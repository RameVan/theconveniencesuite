// Owner login for pre-release downloads, deployed as a Cloudflare Worker at dl.theconveniencesuite.com.
// private.html on the public site signs in here with a username and password; the Worker sets an
// HttpOnly session cookie and then serves apps.json and the builds from the private GitHub repo
// RameVan/convenience-suite-private, using a read-only token that never reaches the browser.
//
// Secrets (set with `npm run set-login` and `npx wrangler secret put GITHUB_TOKEN`, never in the repo):
//   LOGIN_USER, PASSWORD_HASH ("pbkdf2$<iterations>$<salt>$<hash>", base64url), SESSION_KEY, GITHUB_TOKEN
// Roster Reader (src/roster.js) also needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
// Nomadraw (src/nomadraw.js, work in progress) comes from the Worker's static assets after the same session check;
// its sharp map imagery needs ESRI_KEY (an ArcGIS Location Platform API key with the static basemap tiles privilege).
import { roster } from './roster.js';
import { nomadraw } from './nomadraw.js';

const COOKIE = 'suite_session';
const SESSION_DAYS = 30;
const enc = new TextEncoder();

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

function sameBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

async function checkPassword(password, stored) {
  const [scheme, iterations, salt, hash] = String(stored).split('$');
  if (scheme !== 'pbkdf2') return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64url(salt), iterations: Number(iterations) }, key, 256);
  return sameBytes(new Uint8Array(bits), fromB64url(hash));
}

// The session is "<expiry>.<hmac>", signed together with the password hash,
// so setting a new password (or a new SESSION_KEY) signs out every device.
async function sign(env, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(`${data}|${env.PASSWORD_HASH}`)));
}

async function signedIn(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const value = cookie.split(/;\s*/).find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const [expiry, mac] = (value || '').split('.');
  if (!expiry || !mac || Number(expiry) < Date.now()) return false;
  return sameBytes(enc.encode(await sign(env, expiry)), enc.encode(mac));
}

function cors(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

const TYPES = { exe: 'application/vnd.microsoft.portable-executable', zip: 'application/zip', apk: 'application/vnd.android.package-archive', svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', json: 'application/json' };

async function fromGitHub(env, path) {
  const url = `https://api.github.com/repos/${env.REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  return fetch(url, {
    headers: {
      Accept: 'application/vnd.github.raw',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'User-Agent': 'theconveniencesuite-dl',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}

// Files over GitHub's 100 MB file limit (the Windows app) are release assets of the private repo
// instead of repo files: releases/<tag>/<asset name>.
async function fromRelease(env, path) {
  const [, tag, name] = path.split('/');
  const gh = (url, accept) => fetch(url, {
    headers: { Accept: accept, Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'User-Agent': 'theconveniencesuite-dl', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'manual',
  });
  const rel = await gh(`https://api.github.com/repos/${env.REPO}/releases/tags/${encodeURIComponent(tag)}`, 'application/vnd.github+json');
  if (!rel.ok) return rel;
  const asset = (await rel.json()).assets?.find(a => a.name === name);
  if (!asset) return new Response(null, { status: 404 });
  const res = await gh(asset.url, 'application/octet-stream');
  // GitHub answers with a redirect to signed storage; fetch that without our token.
  const location = res.headers.get('Location');
  return location && res.status >= 300 && res.status < 400 ? fetch(location) : res;
}

async function login(request, env, headers) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (env.LOGIN_LIMIT && !(await env.LOGIN_LIMIT.limit({ key: ip })).success) {
    return json({ error: 'Too many attempts. Wait a minute and try again.' }, 429, headers);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, 400, headers); }
  const userOk = sameBytes(enc.encode(String(body.username || '').trim().toLowerCase()), enc.encode(String(env.LOGIN_USER).toLowerCase()));
  const passOk = await checkPassword(String(body.password || ''), env.PASSWORD_HASH);
  if (!userOk || !passOk) return json({ error: "That username and password don't match." }, 401, headers);

  const expiry = String(Date.now() + SESSION_DAYS * 864e5);
  const maxAge = body.remember ? `; Max-Age=${SESSION_DAYS * 86400}` : '';
  return json({ ok: true }, 200, {
    ...headers,
    'Set-Cookie': `${COOKIE}=${expiry}.${await sign(env, expiry)}; Path=/; HttpOnly; Secure; SameSite=Strict${maxAge}`,
  });
}

// ---------- Opt Out access ----------
// Google only lets a limited number of people ever sign in to an unverified app, so Opt Out asks
// here first: people request access from the app, the owner approves them on private.html, and the
// app only sends approved addresses on to Google. One KV entry per address: "optout:<email>".
const ACCESS_STATES = ['pending', 'approved', 'denied'];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
const accessKey = email => `optout:${email}`;
const cleanEmail = value => {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
};

async function readAccess(env, email) {
  return (await env.ACCESS.get(accessKey(email), 'json')) || null;
}

// Public: the app asks whether an address may sign in. Only the state is returned.
async function accessStatus(url, env, headers) {
  const email = cleanEmail(url.searchParams.get('email'));
  if (!email) return json({ error: 'Enter a valid email address.' }, 400, headers);
  return json({ status: (await readAccess(env, email))?.status || 'none' }, 200, headers);
}

// Public: someone asks for access. Repeating a request doesn't change an existing decision.
async function accessRequest(request, env, headers) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (env.REQUEST_LIMIT && !(await env.REQUEST_LIMIT.limit({ key: ip })).success) {
    return json({ error: 'Too many requests. Wait a minute and try again.' }, 429, headers);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, 400, headers); }
  const email = cleanEmail(body.email);
  if (!email) return json({ error: 'Enter a valid email address.' }, 400, headers);
  const existing = await readAccess(env, email);
  if (existing) return json({ status: existing.status }, 200, headers);
  const name = String(body.name || '').trim().slice(0, 80);
  const note = String(body.note || '').trim().slice(0, 300);
  await env.ACCESS.put(accessKey(email), JSON.stringify({ email, name, note, status: 'pending', requestedAt: new Date().toISOString() }));
  return json({ status: 'pending' }, 201, headers);
}

// Owner only: every request, newest first.
async function accessList(env, headers) {
  const entries = [];
  let cursor;
  do {
    const page = await env.ACCESS.list({ prefix: 'optout:', cursor });
    const values = await Promise.all(page.keys.map(k => env.ACCESS.get(k.name, 'json')));
    entries.push(...values.filter(Boolean));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  entries.sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
  return json({ requests: entries }, 200, headers);
}

// Owner only: approve, deny, or remove (forget) an address. Approving an address nobody
// requested adds it directly.
async function accessDecide(request, env, headers) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, 400, headers); }
  const email = cleanEmail(body.email);
  if (!email) return json({ error: 'Enter a valid email address.' }, 400, headers);
  if (body.decision === 'remove') {
    await env.ACCESS.delete(accessKey(email));
    return json({ ok: true }, 200, headers);
  }
  if (!ACCESS_STATES.includes(body.decision) || body.decision === 'pending') return json({ error: 'Unknown decision.' }, 400, headers);
  const entry = (await readAccess(env, email)) || { email, name: '', note: 'Added by the owner', requestedAt: new Date().toISOString() };
  await env.ACCESS.put(accessKey(email), JSON.stringify({ ...entry, status: body.decision, decidedAt: new Date().toISOString() }));
  return json({ ok: true }, 200, headers);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const headers = cors(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    // Nomadraw (WIP): the app, for the signed-in owner only
    const nomadrawResponse = await nomadraw(request, env, url, { signedIn, ctx });
    if (nomadrawResponse) return nomadrawResponse;

    // Roster Reader: the page, its Google sign-in and its calendar calls (same origin, no CORS)
    const rosterResponse = await roster(request, env, url, { signedIn, fromGitHub });
    if (rosterResponse) return rosterResponse;

    // Opt Out access: requests and status checks are public (the app has no owner session)
    if (url.pathname === '/access/status' && request.method === 'GET') return accessStatus(url, env, headers);
    if (url.pathname === '/access/request' && request.method === 'POST') return accessRequest(request, env, headers);
    if (url.pathname === '/access/decide' && request.method === 'POST') {
      if (!(await signedIn(request, env))) return json({ error: 'Signed out.' }, 401, headers);
      return accessDecide(request, env, headers);
    }

    if (url.pathname === '/login' && request.method === 'POST') return login(request, env, headers);
    if (url.pathname === '/logout' && request.method === 'POST') {
      return json({ ok: true }, 200, { ...headers, 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
    }
    if (request.method !== 'GET') return json({ error: 'Not found.' }, 404, headers);
    if (url.pathname === '/') return Response.redirect('https://theconveniencesuite.com/private.html', 302);

    if (!(await signedIn(request, env))) return json({ error: 'Signed out.' }, 401, headers);
    if (url.pathname === '/me') return json({ user: env.LOGIN_USER }, 200, headers);
    if (url.pathname === '/access/list') return accessList(env, headers);

    // /apps is the private repo's apps.json; /file/<path> is one of its builds or icons
    const path = url.pathname === '/apps' ? 'apps.json' : url.pathname.startsWith('/file/') ? decodeURIComponent(url.pathname.slice(6)) : null;
    if (!path || (path !== 'apps.json' && !/^(builds|icons)\/[\w.-]+$/.test(path) && !/^releases\/[\w.-]+\/[\w.-]+$/.test(path))) return json({ error: 'Not found.' }, 404, headers);

    const res = path.startsWith('releases/') ? await fromRelease(env, path) : await fromGitHub(env, path);
    if (res.status === 404) return json({ error: `${path} isn't in the private repo.` }, 404, headers);
    if (!res.ok) return json({ error: `GitHub answered ${res.status}. Check the Worker's GITHUB_TOKEN.` }, 502, headers);
    const name = path.split('/').pop();
    return new Response(res.body, {
      headers: {
        ...headers,
        'Content-Type': TYPES[name.split('.').pop().toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        ...(!path.startsWith('icons/') && path !== 'apps.json' && { 'Content-Disposition': `attachment; filename="${name}"` }),
        ...(res.headers.get('Content-Length') && { 'Content-Length': res.headers.get('Content-Length') }),
      },
    });
  },
};
