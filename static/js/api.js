import * as S from './state.js';
import { fmtSize, triggerDownload, setStatus, setModalStatus } from './helpers.js';

export { fmtSize, setStatus, setModalStatus };

// injected by app.js to break circular dep (async password prompt)
let _promptPassword = async () => null;
export function setPromptPassword(fn) { _promptPassword = fn; }

// ── SSE PARSER ────────────────────────────────────────────────────────────────
async function* parseSSE(response) {
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop();
    for (const part of parts) {
      const line = part.trim();
      if (line.startsWith('data: ')) {
        try { yield JSON.parse(line.slice(6)); } catch {}
      }
    }
  }
}

// ── THROTTLED RENDER ──────────────────────────────────────────────────────────
let _renderPending = false;
function scheduleRender() {
  if (_renderPending) return;
  _renderPending = true;
  setTimeout(() => { _renderPending = false; S.filesChanged(); }, 80); // max ~12fps during load
}

// ── SIZE WARNING ──────────────────────────────────────────────────────────────
export function checkSizeWarn() {
  const mb = S.files.reduce((s, f) => s + (f.size || 0), 0) / 1048576;
  const el = document.getElementById('size-warn');
  if (mb > 40) { el.textContent = `⚠ Total ~${mb.toFixed(0)} MB — merging may be slow.`; el.classList.add('show'); }
  else el.classList.remove('show');
}
S.on('files:change', checkSizeWarn);

// ── ABORT HELPER ──────────────────────────────────────────────────────────────
export function abortLoad(id) {
  if (S.controllers[id]) { S.controllers[id].abort(); delete S.controllers[id]; }
}

// ── LOAD FILES ────────────────────────────────────────────────────────────────
export async function loadFiles(newFiles) {
  for (const file of newFiles) {
    const id = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    S.files.push({ id, filename: file.name, fileObj: file, total: 0, thumbs: [], size: 0, pages: [], loading: true, progress: 0 });
    S.filesChanged();
    await loadOneFile(id, file, S.filePasswords[id] || '');
  }
}

export async function loadOneFile(id, file, password) {
  const tryLoad = async (pw, showPwError) => {
    if (pw === null) { S.setFiles(S.files.filter(f => f.id !== id)); return; }

    const ctrl = new AbortController();
    S.controllers[id] = ctrl;
    const fd = new FormData();
    fd.append('file', file); fd.append('password', pw);

    try {
      const r = await fetch('/pages', { method: 'POST', body: fd, signal: ctrl.signal });

      if (r.status === 401) {
        delete S.controllers[id];
        await tryLoad(await _promptPassword(file.name, showPwError), true);
        return;
      }
      if (!r.ok) {
        delete S.controllers[id];
        const err = await r.json().catch(() => ({ detail: 'Unknown error' }));
        const f = S.files.find(x => x.id === id);
        if (f) { f.loading = false; f.error = err.detail; S.filesChanged(); }
        return;
      }

      // Stream SSE events
      S.filePasswords[id] = pw;
      for await (const event of parseSSE(r)) {
        const f = S.files.find(x => x.id === id);
        if (!f) break;

        if (event.type === 'meta') {
          f.total  = event.total;
          f.size   = event.size || 0;
          f.key    = event.key  || '';
          f.thumbs = [];
          f.progress = 0;
          f.pages  = Array.from({ length: event.total }, (_, i) => ({ include: true, rotation: 0, origIdx: i }));
          S.filesChanged();
        } else if (event.type === 'thumb') {
          f.thumbs[event.index] = event.data;
          f.progress = Math.round(((event.index + 1) / f.total) * 100);
          scheduleRender();
        }
      }

      delete S.controllers[id];
      const f = S.files.find(x => x.id === id);
      if (f) { f.loading = false; f.progress = 100; S.filesChanged(); }

    } catch (e) {
      delete S.controllers[id];
      if (e.name === 'AbortError') return; // file was removed — expected
      const f = S.files.find(x => x.id === id);
      if (f) { f.loading = false; f.error = e.message; S.filesChanged(); }
    }
  };
  await tryLoad(password, false);
}

// ── MERGE ─────────────────────────────────────────────────────────────────────
export async function mergeFiles() {
  const btn      = document.getElementById('merge-btn');
  const fname    = document.getElementById('out-filename').value.trim() || 'merged.pdf';
  const compress = document.getElementById('compress-toggle')?.checked ? 'true' : 'false';
  btn.disabled = true; setStatus('Merging…', 'loading');
  const fd = new FormData(), pagesList = [];
  S.files.forEach(f => {
    fd.append('files', f.fileObj);
    f.pages.forEach(p => { if (p.include) pagesList.push({ file: f.filename, page: p.origIdx, rotation: p.rotation || 0 }); });
  });
  fd.append('pages', JSON.stringify(pagesList));
  fd.append('filename', fname);
  fd.append('compress', compress);
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
    setModalStatus(`${selIndices.length} page(s) extracted as ${fmt.toUpperCase()}.`, 'ok');
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
