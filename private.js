// Owner sign-in for pre-release builds.
// The builds and their list (apps.json) live in a private GitHub repo, never on this public site.
// The Worker in worker/ (dl.theconveniencesuite.com) checks the username and password, sets an
// HttpOnly session cookie and serves the list and files; this page never sees a token or the password
// again after sending it.
//
// apps.json in the private repo:
// { "apps": [ { "name": "Opt Out", "tag": "Web app · Chrome extension", "version": "0.1.0",
//     "desc": "…", "chips": ["…"], "note": "…", "icon": "icons/optout.svg",
//     "colors": { "ink": "#b4541c", "a": "#f08a2c", "b": "#f6b73c" },
//     "files": [ { "label": "Extension", "path": "builds/optout-extension-0.1.0.zip" } ] } ] }
const API = location.hostname === 'localhost' ? 'http://localhost:8788' : 'https://dl.theconveniencesuite.com';

const $ = sel => document.querySelector(sel);
const views = { signin: $('[data-view="signin"]'), list: $('[data-view="list"]') };
const form = $('[data-signin]');
const errorBox = $('[data-error]');
const signout = $('[data-signout]');
const status = $('[data-status]');
const grid = $('[data-apps]');

// The earlier version of this page kept a GitHub token in the browser; drop it
try { localStorage.removeItem('suitePrivateToken'); sessionStorage.removeItem('suitePrivateToken'); } catch { /* storage blocked */ }

class SignedOut extends Error {}

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(API + path, { credentials: 'include', cache: 'no-store', ...options });
  } catch {
    throw new Error("Couldn't reach the sign-in server. Check your connection and try again.");
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') throw new SignedOut();
  if (!res.ok) throw new Error(body.error || `Something went wrong (${res.status}).`);
  return body;
}

const fileUrl = path => `${API}/file/${path.split('/').map(encodeURIComponent).join('/')}`;

function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  signout.hidden = name !== 'list';
}

function fail(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

const downloadIcon = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"/></svg>';

// Everything from apps.json goes in as text, attributes or CSS values, never as HTML.
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
  (app.files || []).filter(file => file?.path).forEach((file, i) => {
    const link = document.createElement('a');
    link.className = i ? 'btn ghost' : 'btn';
    link.href = fileUrl(file.path); // the Worker sends it as an attachment, with the session cookie
    link.innerHTML = downloadIcon;
    link.append(String(file.label || 'Download'));
    actions.append(link);
  });
  if (app.note) Object.assign(el.querySelector('.upcoming-note'), { textContent: app.note, hidden: false });

  const icon = el.querySelector('.app-icon');
  if (app.icon) {
    icon.addEventListener('error', () => icon.remove());
    icon.src = fileUrl(app.icon);
  } else icon.remove();
  return el;
}

async function load() {
  show('list');
  status.textContent = 'Loading…';
  grid.replaceChildren();
  try {
    const list = await api('/apps');
    const apps = Array.isArray(list.apps) ? list.apps : [];
    grid.append(...apps.map(card));
    if (!apps.length) grid.append(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'Nothing waiting right now. Everything is public.' }));
    status.textContent = `${apps.length} unreleased ${apps.length === 1 ? 'app' : 'apps'}`;
  } catch (err) {
    if (err instanceof SignedOut) return showSignIn();
    status.textContent = err.message;
  }
}

function showSignIn(message) {
  grid.replaceChildren();
  errorBox.hidden = true;
  if (message) fail(message);
  show('signin');
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  errorBox.hidden = true;
  const username = form.username.value.trim();
  const password = form.password.value;
  if (!username || !password) return fail('Enter your username and password.');
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await api('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, remember: form.remember.checked }),
    });
    form.reset();
    load();
  } catch (err) {
    form.password.value = '';
    fail(err.message);
  } finally {
    button.disabled = false;
  }
});

signout.addEventListener('click', async () => {
  try { await api('/logout', { method: 'POST' }); } catch { /* cookie is cleared server-side; show the form anyway */ }
  form.reset();
  showSignIn();
});

$('#year').textContent = new Date().getFullYear();
// Already signed in (session cookie still valid)? Go straight to the list.
api('/me').then(load, () => show('signin'));
