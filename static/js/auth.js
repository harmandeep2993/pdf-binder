// Shared-token auth: attaches the token to every request and shows an unlock
// overlay until a valid token is entered. No-op when the server has no token set.

const TOKEN_KEY  = 'pdfbinder_token';
const _origFetch = window.fetch.bind(window);

function getToken()  { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
function setToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch {} }
function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch {} }

// Patch fetch: inject X-Auth-Token on same-origin requests
window.fetch = (input, init = {}) => {
  const token = getToken();
  if (token && typeof input === 'string' && input.startsWith('/')) {
    const headers = new Headers(init.headers || {});
    if (!headers.has('X-Auth-Token')) headers.set('X-Auth-Token', token);
    init = { ...init, headers };
  }
  return _origFetch(input, init);
};

// Overlay
let _overlayEl = null, _resolveSubmit = null;

function buildOverlay() {
  const el = document.createElement('div');
  el.id = 'auth-overlay';
  el.className = 'auth-overlay';
  el.innerHTML = `
    <div class="auth-card" role="dialog" aria-modal="true" aria-label="Access token required">
      <div class="auth-lock">
        <svg width="26" height="26" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.7">
          <rect x="4.5" y="10.5" width="15" height="10" rx="2"/>
          <path stroke-linecap="round" d="M8 10.5V7.5a4 4 0 018 0v3"/>
        </svg>
      </div>
      <h2 class="auth-title">PDF Binder</h2>
      <p class="auth-sub">This instance is protected.<br>Enter your access token to continue.</p>
      <input id="auth-input" class="auth-input" type="password" placeholder="Access token" autocomplete="off" spellcheck="false">
      <button id="auth-submit" class="auth-submit">Unlock</button>
      <div id="auth-error" class="auth-error"></div>
    </div>`;
  document.body.appendChild(el);

  const input  = el.querySelector('#auth-input');
  const submit = el.querySelector('#auth-submit');
  const fire = () => {
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    submit.disabled = true; submit.textContent = 'Checking…';
    const r = _resolveSubmit; _resolveSubmit = null;
    r && r(v);
  };
  submit.addEventListener('click', fire);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') fire(); });
  return el;
}

function showOverlay(wasWrong) {
  if (!_overlayEl) _overlayEl = buildOverlay();
  const err    = _overlayEl.querySelector('#auth-error');
  const submit = _overlayEl.querySelector('#auth-submit');
  const input  = _overlayEl.querySelector('#auth-input');
  err.textContent  = wasWrong ? '✗ Wrong token - try again' : '';
  submit.disabled  = false; submit.textContent = 'Unlock';
  input.value      = '';
  _overlayEl.classList.add('show');
  setTimeout(() => input.focus(), 60);
  return new Promise(res => { _resolveSubmit = res; });
}

function hideOverlay() { _overlayEl && _overlayEl.classList.remove('show'); }

// Gate
// Probe /auth-check; loop showing the overlay until the token is accepted.
export async function ensureAuth() {
  let hadToken = getToken() !== '';
  while (true) {
    let res;
    try {
      const token = getToken();
      res = await _origFetch('/auth-check', token ? { headers: { 'X-Auth-Token': token } } : {});
    } catch {
      return; // network/server down - let the rest of the app surface it
    }
    if (!(res.status === 401 && res.headers.get('X-Auth-Token-Required'))) {
      hideOverlay();
      return; // auth not required, or current token is valid
    }
    if (hadToken) clearToken();          // stored token is stale/wrong
    const entered = await showOverlay(hadToken);
    setToken(entered);
    hadToken = true;
  }
}

// Self-bootstrap as soon as the module loads (deferred module, so DOM is ready).
ensureAuth();
