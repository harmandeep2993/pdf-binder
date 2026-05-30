// Pure utilities and lightweight DOM helpers

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
