import * as S from './state.js';
import { renderGrid, renderPreview } from './render.js';

// injected by app.js at init to break circular dep
let _promptPassword = async () => null;
export function setPromptPassword(fn) { _promptPassword = fn; }

export async function loadFiles(newFiles) {
  for (const file of newFiles) {
    const id = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    S.files.push({ id, filename: file.name, fileObj: file, total: 0, thumbs: [], size: 0, pages: [], loading: true });
    renderGrid();
    await loadOneFile(id, file, S.filePasswords[id] || '');
  }
}

export async function loadOneFile(id, file, password) {
  const tryLoad = async (pw, showPwError) => {
    if (pw === null) { S.setFiles(S.files.filter(f => f.id !== id)); renderGrid(); return; }
    const fd = new FormData();
    fd.append('file', file); fd.append('password', pw);
    try {
      const r = await fetch('/pages', { method: 'POST', body: fd });
      if (r.status === 401) { await tryLoad(await _promptPassword(file.name, showPwError), true); return; }
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: 'Unknown error' }));
        const f = S.files.find(x => x.id === id);
        if (f) { f.loading = false; f.error = err.detail; renderGrid(); }
        return;
      }
      const d = await r.json();
      S.filePasswords[id] = pw;
      const f = S.files.find(x => x.id === id);
      if (f) {
        f.loading = false; f.total = d.total; f.thumbs = d.thumbs;
        f.size = d.size || 0; f.key = d.key || '';
        // origIdx tracks the source page in the original PDF (survives reorder/duplicate)
        f.pages = Array.from({ length: d.total }, (_, i) => ({ include: true, rotation: 0, origIdx: i }));
        renderGrid(); checkSizeWarn();
      }
    } catch (e) {
      const f = S.files.find(x => x.id === id);
      if (f) { f.loading = false; f.error = e.message; renderGrid(); }
    }
  };
  await tryLoad(password, false);
}

export function checkSizeWarn() {
  const mb = S.files.reduce((s, f) => s + (f.size || 0), 0) / 1048576;
  const el = document.getElementById('size-warn');
  if (mb > 40) { el.textContent = `⚠ Total input ~${mb.toFixed(0)} MB — merging may be slow.`; el.classList.add('show'); }
  else el.classList.remove('show');
}

export async function mergeFiles() {
  const btn   = document.getElementById('merge-btn');
  const fname = document.getElementById('out-filename').value.trim() || 'merged.pdf';
  btn.disabled = true; setStatus('Merging…', 'loading');
  const fd = new FormData();
  const pagesList = [];
  S.files.forEach(f => {
    fd.append('files', f.fileObj);
    // use origIdx so duplicated/reordered pages map to correct source page
    f.pages.forEach(p => { if (p.include) pagesList.push({ file: f.filename, page: p.origIdx, rotation: p.rotation || 0 }); });
  });
  fd.append('pages', JSON.stringify(pagesList));
  fd.append('filename', fname);
  fd.append('passwords', JSON.stringify(Object.fromEntries(S.files.map(f => [f.filename, S.filePasswords[f.id] || '']))));
  fd.append('keys',      JSON.stringify(Object.fromEntries(S.files.map(f => [f.filename, f.key || '']))));
  try {
    const r = await fetch('/merge', { method: 'POST', body: fd });
    if (!r.ok) { const e = await r.json(); throw new Error(e.detail); }
    triggerDownload(await r.blob(), fname.endsWith('.pdf') ? fname : fname + '.pdf');
    setStatus(`Done! ${pagesList.length} pages merged.`, 'ok');
  } catch (e) { setStatus('Error: ' + e.message, 'err'); }
  btn.disabled = false;
}

export async function extractSelected(f, fmt, selIndices) {
  // selIndices = frontend page array indices (may contain duplicates)
  setModalStatus('Extracting…', 'loading');
  const origIndices = selIndices.map(i => f.pages[i].origIdx);
  const rotMap = {};
  selIndices.forEach((fi, pos) => { if (f.pages[fi].rotation) rotMap[pos] = f.pages[fi].rotation; });
  const fd = new FormData();
  fd.append('file', f.fileObj); fd.append('page_indices', JSON.stringify(origIndices));
  fd.append('rotations', JSON.stringify(rotMap)); fd.append('as_images', fmt !== 'pdf' ? 'true' : 'false');
  fd.append('image_format', fmt === 'png' ? 'png' : 'jpeg'); fd.append('password', S.filePasswords[f.id] || '');
  fd.append('key', f.key || '');
  try {
    const r = await fetch('/split', { method: 'POST', body: fd });
    if (!r.ok) { const e = await r.json(); throw new Error(e.detail); }
    triggerDownload(await r.blob(), f.filename.replace('.pdf', '') + (fmt === 'pdf' ? '_extract.zip' : '_images.zip'));
    setModalStatus(`${selIndices.length} page(s) downloaded as ${fmt.toUpperCase()}.`, 'ok');
  } catch (e) { setModalStatus('Error: ' + e.message, 'err'); }
}

export async function splitAllPages(f, fmt) {
  // send all pages in current order (including duplicates) using origIdx
  const origIndices = f.pages.map(p => p.origIdx);
  const rotMap = {};
  f.pages.forEach((p, pos) => { if (p.rotation) rotMap[pos] = p.rotation; });
  setModalStatus('Splitting…', 'loading');
  const fd = new FormData();
  fd.append('file', f.fileObj); fd.append('page_indices', JSON.stringify(origIndices));
  fd.append('rotations', JSON.stringify(rotMap)); fd.append('as_images', fmt !== 'pdf' ? 'true' : 'false');
  fd.append('image_format', fmt === 'png' ? 'png' : 'jpeg'); fd.append('password', S.filePasswords[f.id] || '');
  fd.append('key', f.key || '');
  try {
    const r = await fetch('/split', { method: 'POST', body: fd });
    if (!r.ok) { const e = await r.json(); throw new Error(e.detail); }
    triggerDownload(await r.blob(), f.filename.replace('.pdf', '') + '_split.zip');
    setModalStatus(`${f.pages.length} pages split.`, 'ok');
  } catch (e) { setModalStatus('Error: ' + e.message, 'err'); }
}

export function setStatus(msg, type = '') {
  const el = document.getElementById('status');
  el.textContent = msg; el.className = 'status' + (type ? ' ' + type : '');
}
export function setModalStatus(msg, type = '') {
  const el = document.getElementById('modal-status');
  el.textContent = msg; el.className = 'modal-status' + (type ? ' ' + type : '');
}
export function fmtSize(b) {
  if (!b) return '';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
export function triggerDownload(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(u), 5000);
}
