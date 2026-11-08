// Owner sign-in for pre-release builds.
// The builds and their list (apps.json) live in a private GitHub repo, never on this public site.
// "Signing in" is pasting a fine-grained GitHub token that can read that repo; this page sends it
// only to api.github.com (see the CSP in private.html) and keeps it in this browser's storage.
//
// apps.json in the private repo:
// { "apps": [ { "name": "Opt Out", "tag": "Web app · Chrome extension", "version": "0.1.0",
//     "desc": "…", "chips": ["…"], "note": "…", "icon": "icons/optout.svg",
//     "colors": { "ink": "#b4541c", "a": "#f08a2c", "b": "#f6b73c" },
//     "files": [ { "label": "Extension", "path": "builds/optout-extension-0.1.0.zip" } ] } ] }
const REPO = 'RameVan/convenience-suite-private';
const KEY = 'suitePrivateToken';

const $ = sel => document.querySelector(sel);
const views = { signin: $('[data-view="signin"]'), list: $('[data-view="list"]') };
const form = $('[data-signin]');
const errorBox = $('[data-error]');
const signout = $('[data-signout]');
const status = $('[data-status]');
const grid = $('[data-apps]');
const objectUrls = [];

const store = {
  get() {
    try { return sessionStorage.getItem(KEY) || localStorage.getItem(KEY); } catch { return null; }
  },
  set(token, remember) {
    try { (remember ? localStorage : sessionStorage).setItem(KEY, token); } catch { /* storage blocked: signed in for this page only */ }
  },
  clear() {
    try { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); } catch { /* nothing stored */ }
  },
};
let token = store.get();

class AuthError extends Error {}

// Reads a file from the private repo. Contents API "raw" handles files up to 100 MB and,
// unlike release-asset downloads, sends CORS headers, so it works straight from the browser.
async function readFile(path) {
  const url = `https://api.github.com/repos/${REPO}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github.raw', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    cache: 'no-store',
  });
  if (res.status === 401) throw new AuthError("GitHub didn't accept that token. It may be mistyped, expired or revoked.");
  if (res.status === 403 || res.status === 404) {
    const missing = path === 'apps.json' ? `This token can't read ${REPO}. Give it Contents: read on that repository.` : `${path} isn't in the private repo.`;
    throw new (path === 'apps.json' ? AuthError : Error)(missing);
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status}. Try again in a minute.`);
  return res.blob();
}

function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  signout.hidden = name !== 'list';
}

function fail(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function sizeText(bytes) {
  return bytes > 1e6 ? (bytes / 1e6).toFixed(1) + ' MB' : Math.ceil(bytes / 1e3) + ' KB';
}

const downloadIcon = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"/></svg>';

function downloadButton(file, primary) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = primary ? 'btn' : 'btn ghost';
  btn.innerHTML = downloadIcon;
  btn.append(String(file.label || 'Download'));
  btn.addEventListener('click', async () => {
    const label = btn.lastChild.textContent;
    btn.disabled = true;
    btn.lastChild.textContent = 'Downloading…';
    try {
      const blob = await readFile(file.path);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.path.split('/').pop();
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    } catch (err) {
      if (err instanceof AuthError) return signOut(err.message);
      status.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.lastChild.textContent = label;
    }
  });
  return btn;
}

// Everything from apps.json goes in as text or CSS values, never as HTML.
function card(app) {
  const el = $('#app-card').content.firstElementChild.cloneNode(true);
  const color = /^#[0-9a-f]{3,8}$/i;
  for (const [prop, value] of [['--app-ink', app.colors?.ink], ['--app-a', app.colors?.a], ['--app-b', app.colors?.b]]) {
    el.style.setProperty(prop, color.test(value) ? value : 'var(--orange)');
  }
  const tag = el.querySelector('.tag');
  tag.textContent = app.tag || 'Pre-release';
  tag.classList.add('pre');
  el.querySelector('h3').textContent = app.name || 'Untitled app';
  el.querySelector('.desc').textContent = app.desc || '';
  const chips = el.querySelector('.chips');
  for (const chip of app.chips || []) chips.append(Object.assign(document.createElement('li'), { textContent: chip }));
  if (!chips.children.length) chips.remove();
  el.querySelector('.version').textContent = [app.version && `v${app.version}`, 'Pre-release'].filter(Boolean).join(' · ');
  const actions = el.querySelector('.actions');
  (app.files || []).forEach((file, i) => file?.path && actions.append(downloadButton(file, i === 0)));
  if (app.note) Object.assign(el.querySelector('.upcoming-note'), { textContent: app.note, hidden: false });

  const icon = el.querySelector('.app-icon');
  if (app.icon) {
    // GitHub labels raw files application/vnd.github.raw; an <img> needs the real image type
    const type = { svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp' }[app.icon.split('.').pop().toLowerCase()];
    readFile(app.icon).then(blob => {
      const url = URL.createObjectURL(new Blob([blob], { type }));
      objectUrls.push(url);
      icon.src = url;
    }).catch(() => icon.remove());
  } else icon.remove();
  return el;
}

async function load() {
  show('list');
  status.textContent = 'Loading…';
  grid.replaceChildren();
  try {
    const list = JSON.parse(await (await readFile('apps.json')).text());
    const apps = Array.isArray(list.apps) ? list.apps : [];
    grid.append(...apps.map(card));
    if (!apps.length) grid.append(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'Nothing waiting right now. Everything is public.' }));
    status.textContent = `${apps.length} unreleased ${apps.length === 1 ? 'app' : 'apps'} · from ${REPO}`;
  } catch (err) {
    if (err instanceof AuthError) return signOut(err.message);
    status.textContent = err instanceof SyntaxError ? "apps.json in the private repo isn't valid JSON." : err.message;
  }
}

function signOut(message) {
  store.clear();
  token = null;
  objectUrls.splice(0).forEach(URL.revokeObjectURL);
  grid.replaceChildren();
  form.reset();
  errorBox.hidden = true;
  if (message) fail(message);
  show('signin');
}

// A token GitHub rejects is cleared again by load() -> signOut(), which shows why
form.addEventListener('submit', e => {
  e.preventDefault();
  errorBox.hidden = true;
  const value = form.token.value.trim();
  if (!/^(github_pat_|ghp_|gho_)\w{20,}$/.test(value)) return fail('That doesn\'t look like a GitHub token. It starts with "github_pat_".');
  token = value;
  store.set(token, form.remember.checked);
  form.reset();
  load();
});

signout.addEventListener('click', () => signOut());
$('#year').textContent = new Date().getFullYear();
token ? load() : show('signin');
