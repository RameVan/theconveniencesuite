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
const userChip = $('[data-user]');
const userName = $('[data-user-name]');
const USER_HINT = 'suiteUser'; // read by index.html to show the username instead of "Sign in"
const status = $('[data-status]');
const grid = $('[data-apps]');
const count = $('[data-count]');

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

// Roster Reader runs on the Worker's own domain, so the session cookie goes with it
document.querySelector('[data-roster-link]').href = `${API}/roster-reader`;
document.querySelector('[data-nomadraw-link]').href = `${API}/nomadraw/`;

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

// ---------- Opt Out access requests ----------
const accessList = $('[data-access-list]');
const accessStatus = $('[data-access-status]');
const accessError = $('[data-access-error]');
const accessAdd = $('[data-access-add]');
const STATE_LABEL = { pending: 'Waiting', approved: 'Approved', denied: 'Denied' };
const dateText = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };

async function decide(email, decision) {
  accessError.hidden = true;
  try {
    await api('/access/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, decision }) });
    await loadAccess();
  } catch (err) {
    if (err instanceof SignedOut) return showSignIn();
    Object.assign(accessError, { textContent: err.message, hidden: false });
  }
}

function accessRow(r) {
  const el = $('#access-row').content.firstElementChild.cloneNode(true);
  el.querySelector('.who b').textContent = r.email;
  el.querySelector('.name').textContent = r.name || '';
  el.querySelector('.note').textContent = r.note || '';
  const state = el.querySelector('.state');
  state.textContent = STATE_LABEL[r.status] || r.status;
  state.classList.add(r.status);
  el.querySelector('.when').textContent = dateText(r.decidedAt || r.requestedAt);
  const actions = el.querySelector('.actions');
  const button = (label, decision, ghost) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: ghost ? 'btn ghost' : 'btn', textContent: label });
    b.addEventListener('click', () => { b.disabled = true; decide(r.email, decision); });
    actions.append(b);
  };
  if (r.status !== 'approved') button('Approve', 'approved');
  if (r.status === 'pending') button('Deny', 'denied', true);
  if (r.status === 'approved') button('Revoke', 'denied', true);
  button('Remove', 'remove', true);
  return el;
}

async function loadAccess() {
  try {
    const { requests = [] } = await api('/access/list');
    accessList.replaceChildren(...requests.map(accessRow));
    const waiting = requests.filter(r => r.status === 'pending').length;
    const approved = requests.filter(r => r.status === 'approved').length;
    accessStatus.textContent = `${waiting} waiting · ${approved} approved`;
  } catch (err) {
    if (err instanceof SignedOut) return showSignIn();
    accessStatus.textContent = err.message;
  }
}

accessAdd.addEventListener('submit', e => {
  e.preventDefault();
  const email = accessAdd.email.value.trim();
  if (!email) return;
  accessAdd.reset();
  decide(email, 'approved');
});

async function load() {
  show('list');
  loadAccess();
  Object.assign(status, { textContent: 'Loading…', hidden: false });
  count.textContent = '–';
  grid.replaceChildren();
  try {
    const list = await api('/apps');
    const apps = Array.isArray(list.apps) ? list.apps : [];
    grid.append(...apps.map(card));
    if (!apps.length) grid.append(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'Nothing waiting right now. Everything is public.' }));
    count.textContent = apps.length; // the tile shows the count, so the status line is only for loading and errors
    status.hidden = true;
  } catch (err) {
    if (err instanceof SignedOut) return showSignIn();
    status.textContent = err.message;
  }
}

// Shows who is signed in, top right here and (via the localStorage hint) on the main page
function setUser(user) {
  userChip.hidden = !user;
  userName.textContent = user || '';
  try { user ? localStorage.setItem(USER_HINT, user) : localStorage.removeItem(USER_HINT); } catch { /* storage blocked */ }
}

// Session cookie still valid? Then show the list, otherwise the form.
const start = () => api('/me').then(({ user }) => { setUser(user); load(); }, () => showSignIn());

function showSignIn(message) {
  setUser(null);
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
    start();
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
start();
