// Pure utilities and DOM helpers

export const $  = (sel, ctx = document) => ctx.querySelector(sel);
export const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

export function fmtSize(b) {
  if (!b) return '';
  if (b < 1024)    return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

export function triggerDownload(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 5000);
}

export function setStatus(msg, type = '') {
  const el = document.getElementById('status');
  if (el) { el.textContent = msg; el.className = 'status' + (type ? ' ' + type : ''); }
}

export function setModalStatus(msg, type = '') {
  const el = document.getElementById('modal-status');
  if (el) { el.textContent = msg; el.className = 'modal-status' + (type ? ' ' + type : ''); }
}

export function getStorage(key, fallback = null) {
  try { return localStorage.getItem(key) ?? fallback; }
  catch { return fallback; }
}

export function setStorage(key, value) {
  try { localStorage.setItem(key, String(value)); } catch {}
}

/**
 * Trap keyboard focus inside `container` while it is open.
 * Returns an unsubscribe function to remove the listener.
 */
export function trapFocus(container) {
  const SELECTOR = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function getFocusable() {
    return [...container.querySelectorAll(SELECTOR)].filter(el => !el.closest('[hidden]'));
  }

  function onKeydown(e) {
    if (e.key !== 'Tab') return;
    const els = getFocusable();
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !container.contains(active)) { e.preventDefault(); last.focus(); }
    } else {
      if (active === last  || !container.contains(active)) { e.preventDefault(); first.focus(); }
    }
  }

  container.addEventListener('keydown', onKeydown);
  // Focus first element
  const first = getFocusable()[0];
  if (first) setTimeout(() => first.focus(), 50);
  return () => container.removeEventListener('keydown', onKeydown);
}
