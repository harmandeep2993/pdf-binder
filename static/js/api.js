import * as S from './state.js';
import { fmtSize, triggerDownload, setStatus, setModalStatus } from './helpers.js';

export { fmtSize, setStatus, setModalStatus };  // re-export for consumers

// injected by app.js to break circular dep (async password prompt)
let _promptPassword = async () => null;
export function setPromptPassword(fn) { _promptPassword = fn; }

// ── SIZE WARNING ──────────────────────────────────────────────────────────────
export function checkSizeWarn() {
  const mb = S.files.reduce((s, f) => s + (f.size || 0), 0) / 1048576;
  const el = document.getElementById('size-warn');
  if (mb > 40) { el.textContent = `⚠ Total ~${mb.toFixed(0)} MB — merging may be slow.`; el.classList.add('show'); }
  else el.classList.remove('show');
}
S.on('files:change', checkSizeWarn);

// ── LOAD FILES ────────────────────────────────────────────────────────────────
export async function loadFiles(newFiles) {
  for (const file of newFiles) {
    const id = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    S.files.push({ id, filename: file.name, fileObj: file, total: 0, thumbs: [], size: 0, pages: [], loading: true });
    S.filesChanged();
    await loadOneFile(id, file, S.filePasswords[id] || '');
  }
}

export async function loadOneFile(id, file, password) {
  const tryLoad = async (pw, showPwError) => {
    if (pw === null) { S.setFiles(S.files.filter(f => f.id !== id)); return; }
    const fd = new FormData();
    fd.append('file', file); fd.append('password', pw);
    try {
      const r = await fetch('/pages', { method: 'POST', body: fd });
      if (r.status === 401) { await tryLoad(await _promptPassword(file.name, showPwError), true); return; }
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: 'Unknown error' }));
        const f = S.files.find(x => x.id === id);
        if (f) { f.loading = false; f.error = err.detail; S.filesChanged(); }
        return;
      }
      const d = await r.json();
      S.filePasswords[id] = pw;
      const f = S.files.find(x => x.id === id);
      if (f) {
        f.loading = false; f.total = d.total; f.thumbs = d.thumbs;
        f.size = d.size || 0; f.key = d.key || '';
        f.pages = Array.from({ length: d.total }, (_, i) => ({ include: true, rotation: 0, origIdx: i }));
        S.filesChanged();
      }
    } catch (e) {
      const f = S.files.find(x => x.id === id);
      if (f) { f.loading = false; f.error = e.message; S.filesChanged(); }
    }
  };
  await tryLoad(password, false);
}

// ── MERGE ─────────────────────────────────────────────────────────────────────
export async function mergeFiles() {
  const btn   = document.getElementById('merge-btn');
  const fname = document.getElementById('out-filename').value.trim() || 'merged.pdf';
  btn.disabled = true; setStatus('Merging…', 'loading');
  const fd = new FormData(), pagesList = [];
  S.files.forEach(f => {
    fd.append('files', f.fileObj);
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

// ── EXTRACT / SPLIT ───────────────────────────────────────────────────────────
export async function extractSelected(f, fmt, selIndices) {
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
