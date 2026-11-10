// Roster Reader on dl.theconveniencesuite.com: serves the page to the signed-in owner and connects it to
// Google Calendar. The page itself lives in the private repo (apps/roster-reader.html, put there by
// build-private.ps1). Screenshots are read in the browser; this file only talks to Google.
//
// The Google refresh token is kept in an encrypted HttpOnly cookie on this domain (AES-GCM with a key
// derived from SESSION_KEY), so nothing is stored in Cloudflare and the page never sees a token.
//
// Secrets (`npx wrangler secret put …`): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, from a Google Cloud OAuth
// client of type "Web application" with these redirect URIs:
//   https://dl.theconveniencesuite.com/google/callback
//   http://localhost:8788/google/callback   (npm run dev)
const G_COOKIE = 'roster_google';
const STATE_COOKIE = 'roster_google_state';
const SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');
const CALENDAR = 'https://www.googleapis.com/calendar/v3';
const enc = new TextEncoder();

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

const readCookie = (request, name) =>
  (request.headers.get('Cookie') || '').split(/;\s*/).find(c => c.startsWith(`${name}=`))?.slice(name.length + 1) || '';

// Secure cookies don't stick on plain http://localhost, so drop the flag for `npm run dev`.
const secure = url => (url.protocol === 'https:' ? '; Secure' : '');

async function aesKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`roster-google|${env.SESSION_KEY}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function seal(env, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(JSON.stringify(data)));
  return `${b64url(iv)}.${b64url(ct)}`;
}

async function unseal(env, value) {
  try {
    const [iv, ct] = value.split('.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await aesKey(env), fromB64url(ct));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

const tokenCookie = (url, value, maxAge) =>
  `${G_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure(url)}`;

// A short page that moves on to Roster Reader by itself. The trip back from Google is a cross-site
// redirect, which doesn't carry the SameSite=Strict session cookie; a navigation started by this
// page does.
function bounce(url, result, setCookies = []) {
  const target = `/roster-reader?google=${result}`;
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'",
  });
  for (const c of setCookies) headers.append('Set-Cookie', c);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${target}"><title>Roster Reader</title><p><a href="${target}">Back to Roster Reader</a></p>`,
    { headers },
  );
}

async function googleToken(env, params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

// A fresh access token for every request, from the refresh token in the cookie.
class Disconnected extends Error {}
async function accessToken(request, env) {
  const saved = await unseal(env, readCookie(request, G_COOKIE));
  if (!saved?.rt) throw new Disconnected();
  const { ok, body } = await googleToken(env, { grant_type: 'refresh_token', refresh_token: saved.rt });
  if (!ok) {
    if (body.error === 'invalid_grant') throw new Disconnected();   // revoked or expired at Google
    throw new Error(`Google sign-in failed (${body.error || 'unknown error'}).`);
  }
  return body.access_token;
}

async function calendarApi(token, path, options = {}) {
  const res = await fetch(CALENDAR + path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message || `Google Calendar answered ${res.status}.`);
  return body;
}

// The page's own calendar calls: list writable calendars, list events, add events.
async function calendar(request, env, url) {
  if (url.pathname === '/calendar/status') {
    const saved = await unseal(env, readCookie(request, G_COOKIE));
    return json({ connected: !!saved?.rt, email: saved?.email || null });
  }
  const token = await accessToken(request, env);

  if (url.pathname === '/calendar/calendars' && request.method === 'GET') {
    const body = await calendarApi(token, '/users/me/calendarList?minAccessRole=writer&maxResults=250');
    const calendars = (body.items || []).map(c => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary }));
    return json({ calendars });
  }

  if (url.pathname === '/calendar/events' && request.method === 'GET') {
    const id = url.searchParams.get('calendarId');
    const q = new URLSearchParams({
      singleEvents: 'true', maxResults: '2500', orderBy: 'startTime',
      timeMin: url.searchParams.get('timeMin') || '', timeMax: url.searchParams.get('timeMax') || '',
      timeZone: url.searchParams.get('timeZone') || 'Europe/Amsterdam',
    });
    if (!id || !q.get('timeMin') || !q.get('timeMax')) return json({ error: 'Missing calendar or dates.' }, 400);
    const body = await calendarApi(token, `/calendars/${encodeURIComponent(id)}/events?${q}`);
    const events = (body.items || []).filter(e => e.status !== 'cancelled').map(e => ({
      summary: e.summary || '',
      allDay: !!e.start?.date,
      start: e.start?.dateTime || e.start?.date || '',
      end: e.end?.dateTime || e.end?.date || '',
    }));
    return json({ events });
  }

  if (url.pathname === '/calendar/events' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
    const id = String(body.calendarId || '');
    const list = Array.isArray(body.events) ? body.events : [];
    if (!id || !list.length || list.length > 100) return json({ error: 'Send between 1 and 100 events.' }, 400);
    const time = t => (t?.date ? { date: String(t.date).slice(0, 10) } : { dateTime: String(t?.dateTime || ''), timeZone: String(t?.timeZone || 'Europe/Amsterdam') });
    const failed = [];
    let created = 0;
    for (const [index, e] of list.entries()) {
      try {
        await calendarApi(token, `/calendars/${encodeURIComponent(id)}/events`, {
          method: 'POST',
          body: JSON.stringify({
            summary: String(e.summary || 'Work').slice(0, 200),
            description: String(e.description || '').slice(0, 2000),
            start: time(e.start),
            end: time(e.end),
          }),
        });
        created++;
      } catch (err) {
        failed.push({ index, error: err.message });
      }
    }
    return json({ created, failed });
  }
  return json({ error: 'Not found.' }, 404);
}

// Handles /roster-reader, /google/* and /calendar/*; returns null for anything else.
export async function roster(request, env, url, { signedIn, fromGitHub }) {
  const p = url.pathname;
  if (p !== '/roster-reader' && !p.startsWith('/google/') && !p.startsWith('/calendar/')) return null;

  // Google sends the browser back here cross-site, without the session cookie; the state cookie, set
  // only by /google/connect for the signed-in owner, is what ties this answer to that request.
  if (p === '/google/callback') {
    const state = readCookie(request, STATE_COOKIE);
    const clearState = `${STATE_COOKIE}=; Path=/google; HttpOnly; SameSite=Lax; Max-Age=0${secure(url)}`;
    if (url.searchParams.get('error')) return bounce(url, 'denied', [clearState]);
    if (!state || state !== url.searchParams.get('state') || !url.searchParams.get('code')) return bounce(url, 'error', [clearState]);
    const { ok, body } = await googleToken(env, {
      grant_type: 'authorization_code',
      code: url.searchParams.get('code'),
      redirect_uri: `${url.origin}/google/callback`,
    });
    if (!ok || !body.refresh_token) return bounce(url, 'error', [clearState]);
    let email = null;
    try { email = JSON.parse(new TextDecoder().decode(fromB64url(body.id_token.split('.')[1]))).email || null; } catch { /* no email: fine */ }
    // Chrome keeps cookies for at most 400 days
    return bounce(url, 'connected', [clearState, tokenCookie(url, await seal(env, { rt: body.refresh_token, email }), 400 * 86400)]);
  }

  if (!(await signedIn(request, env))) {
    if (p === '/roster-reader' || p === '/google/connect') return Response.redirect('https://theconveniencesuite.com/private.html', 302);
    return json({ error: 'Signed out.', code: 'signed_out' }, 401);
  }

  // The page: same origin as these endpoints, so the session cookie goes with every call.
  if (p === '/roster-reader' && request.method === 'GET') {
    const res = await fromGitHub(env, 'apps/roster-reader.html');
    if (res.status === 404) return new Response("Roster Reader isn't in the private repo yet. Run build-private.ps1 -Push.", { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    if (!res.ok) return new Response(`GitHub answered ${res.status}. Check the Worker's GITHUB_TOKEN.`, { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    return new Response(res.body, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        // Tesseract (the in-browser text reader) loads from jsDelivr and runs as WebAssembly in a worker
        'Content-Security-Policy': [
          "default-src 'none'",
          "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
          "worker-src blob: https://cdn.jsdelivr.net",
          "connect-src 'self' https://cdn.jsdelivr.net blob: data:",
          "img-src 'self' blob: data: https://theconveniencesuite.com",
          "style-src 'unsafe-inline'",
          "font-src https://theconveniencesuite.com",
          "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
        ].join('; '),
      },
    });
  }

  if (p === '/google/connect' && request.method === 'GET') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return new Response('Google sign-in is not set up yet: add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the Worker.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${url.origin}/google/callback`,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',            // always hands out a refresh token
      include_granted_scopes: 'true',
      state,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: auth.toString(), 'Set-Cookie': `${STATE_COOKIE}=${state}; Path=/google; HttpOnly; SameSite=Lax; Max-Age=600${secure(url)}` },
    });
  }

  // Writes only from this site's own pages (on top of the SameSite=Strict session cookie)
  if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) return json({ error: 'Not allowed.' }, 403);

  if (p === '/google/disconnect' && request.method === 'POST') {
    const saved = await unseal(env, readCookie(request, G_COOKIE));
    if (saved?.rt) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(saved.rt)}`, { method: 'POST' }).catch(() => {});
    return json({ ok: true }, 200, { 'Set-Cookie': tokenCookie(url, '', 0) });
  }

  if (p.startsWith('/calendar/')) {
    try {
      return await calendar(request, env, url);
    } catch (err) {
      if (err instanceof Disconnected) return json({ error: 'Google Calendar is not connected.', code: 'google_disconnected' }, 401, { 'Set-Cookie': tokenCookie(url, '', 0) });
      return json({ error: err.message }, 502);
    }
  }
  return json({ error: 'Not found.' }, 404);
}
