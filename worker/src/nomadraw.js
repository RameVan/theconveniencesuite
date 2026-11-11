// Nomadraw (work in progress) on dl.theconveniencesuite.com/nomadraw/, for the signed-in owner only.
// The app's files are Workers Static Assets (the "assets" block in wrangler.jsonc, folder worker/assets/, git-ignored):
// sync-nomadraw.mjs fills it from a Nomadraw build before a deploy, so no unreleased build is ever in this public repo.
// run_worker_first: every request comes here first, and the files go out only after the session check.
//
// Signed out, a page asks for the username and password itself (same origin, the usual /login): an app added to
// the iPhone home screen keeps its own cookies, apart from Safari's, so it has to be able to sign in on its own.

const PREFIX = '/nomadraw';

const signInPage = () => new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#141412"><meta name="robots" content="noindex">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Nomadraw WIP"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="${PREFIX}/wip/icon-180.png"><link rel="manifest" href="${PREFIX}/manifest.webmanifest">
<title>Nomadraw WIP · sign in</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #141412; color: #f3efe8;
         font: 500 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; box-sizing: border-box; }
  form { width: min(360px, 100%); display: grid; gap: 14px; padding: 24px; border-radius: 26px; background: rgba(30,30,28,.9);
         border: 1px solid rgba(255,255,255,.1); box-shadow: 0 18px 40px rgba(0,0,0,.4); }
  img { width: 64px; height: 64px; border-radius: 15px; }
  h1 { margin: 0; font-size: 26px; font-weight: 400; letter-spacing: -.02em; } p { margin: 0; color: #b9b2a7; font-size: 14px; }
  label { display: grid; gap: 6px; font-size: 13px; color: #8d877d; }
  input { height: 48px; border-radius: 14px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.07); color: #f3efe8; font: inherit; padding: 0 14px; }
  button { height: 50px; border: 0; border-radius: 25px; background: #e8692e; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
  .err { color: #f2735f; font-size: 14px; } .err:empty { display: none; }
</style></head>
<body><form id="f">
  <img src="${PREFIX}/wip/icon-180.png" alt="">
  <h1>Nomadraw <span style="color:#f39a5b">WIP</span></h1>
  <p>Sign in with your Convenience Suite owner login.</p>
  <label>Username<input name="username" autocomplete="username" autocapitalize="none" required></label>
  <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
  <p class="err" id="e" role="alert"></p>
  <button>Sign in</button>
</form>
<script>
  document.getElementById('f').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const d = new FormData(ev.target), e = document.getElementById('e');
    e.textContent = '';
    try {
      const r = await fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ username: d.get('username'), password: d.get('password'), remember: true }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) { e.textContent = b.error || 'Sign-in failed (' + r.status + ').'; return; }
      location.replace('${PREFIX}/');
    } catch { e.textContent = "Couldn't reach the server. Check your connection."; }
  });
</script></body></html>`, { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

// Handles /nomadraw and everything under it; returns null for anything else.
export async function nomadraw(request, env, url, { signedIn }) {
  const p = url.pathname;
  if (p !== PREFIX && !p.startsWith(`${PREFIX}/`)) return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Not found', { status: 404 });
  if (p === PREFIX) return Response.redirect(`${url.origin}${PREFIX}/`, 301);
  // the sign-in page needs its icon and the manifest (the home screen reads them before anyone signs in)
  const open = p === `${PREFIX}/manifest.webmanifest` || p.startsWith(`${PREFIX}/wip/`);
  if (!open && !(await signedIn(request, env))) {
    const page = (request.headers.get('Accept') || '').includes('text/html');
    return page ? signInPage() : new Response('Signed out', { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  // Sharp imagery for close zoom: Esri World Imagery through the ArcGIS basemap tile service, with the key kept here
  // (secret ESRI_KEY: npx wrangler secret put ESRI_KEY). /api/imagery tells the app whether it is there.
  if (p === `${PREFIX}/api/imagery`) return new Response(JSON.stringify({ esri: !!env.ESRI_KEY }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  const tile = p.match(/^\/nomadraw\/api\/esri\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/);
  if (tile) {
    if (!env.ESRI_KEY) return new Response('No imagery key on the server.', { status: 503 });
    const res = await fetch(`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/${tile[1]}/${tile[2]}/${tile[3]}?token=${encodeURIComponent(env.ESRI_KEY)}`);
    if (!res.ok) return new Response(`Imagery answered ${res.status}.`, { status: res.status === 404 ? 404 : 502, headers: { 'Cache-Control': 'no-store' } });
    return new Response(res.body, { headers: { 'Content-Type': res.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (p.startsWith(`${PREFIX}/api/`)) return new Response('Not found', { status: 404 });
  if (!env.ASSETS) return new Response('Nomadraw is not deployed with this Worker yet (run sync-nomadraw.mjs, then deploy).', { status: 503 });
  const res = await env.ASSETS.fetch(request);
  if (res.status === 404) return new Response("Not in this Nomadraw build. Run sync-nomadraw.mjs and deploy again.", { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const out = new Response(res.body, res);
  // private: nothing in a shared cache; the app files are re-checked on each load (it changes often while it's a WIP)
  out.headers.set('Cache-Control', open ? 'public, max-age=3600' : 'private, no-cache');
  out.headers.set('X-Robots-Tag', 'noindex');
  out.headers.set('X-Content-Type-Options', 'nosniff');
  return out;
}
