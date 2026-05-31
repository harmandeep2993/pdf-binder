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
          f.total        = event.total;
          f.size         = event.size || 0;
          f.key          = event.key  || '';
          f.thumbs       = [];
          f.progress     = 0;
          f.docTitle     = event.doc_title  || '';
          f.docAuthor    = event.doc_author || '';
          f.hasBookmarks = !!event.has_bookmarks;
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
const _MERGE_BTN_HTML = `<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4-4 4m0 0-4-4m4 4V4"/></svg>Merge &amp; Download`;
const _MERGE_BTN_LOADING = `<span class="btn-spinner"></span>Merging…`;

export async function mergeFiles() {
  const btn            = document.getElementById('merge-btn');
  const fname          = document.getElementById('out-filename').value.trim() || 'merged.pdf';
  const compress       = document.getElementById('compress-toggle')?.checked    ? 'true' : 'false';
  const pageNumbers    = document.getElementById('pagenums-toggle')?.checked    ? 'true' : 'false';
  const normalize      = document.getElementById('normalize-toggle')?.checked   ? 'true' : 'false';
  const grayscale      = document.getElementById('grayscale-toggle')?.checked   ? 'true' : 'false';
  const bookmarks      = document.getElementById('bookmarks-toggle')?.checked   ? 'true' : 'false';
  const flatten        = document.getElementById('flatten-toggle')?.checked      ? 'true' : 'false';
  const outputPassword = document.getElementById('output-password')?.value.trim() || '';

  btn.disabled = true; btn.innerHTML = _MERGE_BTN_LOADING;
  setStatus('Merging…', 'loading');
  const fd = new FormData(), pagesList = [];
  S.files.forEach(f => {
    if (f.type !== 'blank') fd.append('files', f.fileObj);
    f.pages.forEach(p => {
      if (!p.include) return;
      if (p.type === 'blank') pagesList.push({ type: 'blank', width: p.width || 595, height: p.height || 842 });
      else {
        const entry = { file: f.filename, page: p.origIdx, rotation: p.rotation || 0 };
        if (p.crop) entry.crop = p.crop;
        pagesList.push(entry);
      }
    });
  });
  fd.append('pages',            JSON.stringify(pagesList));
  fd.append('filename',         fname);
  fd.append('compress',         compress);
  fd.append('page_numbers',     pageNumbers);
  fd.append('normalize',        normalize);
  fd.append('grayscale',        grayscale);
  fd.append('bookmarks',        bookmarks);
  fd.append('flatten_forms',    flatten);
  fd.append('output_password',  outputPassword);
  fd.append('metadata',         JSON.stringify(S.mergeMetadata));
  fd.append('passwords',        JSON.stringify(Object.fromEntries(S.files.filter(f => f.type !== 'blank').map(f => [f.filename, S.filePasswords[f.id] || '']))));
  fd.append('keys',             JSON.stringify(Object.fromEntries(S.files.filter(f => f.type !== 'blank').map(f => [f.filename, f.key || '']))));
  try {
    const r = await fetch('/merge', { method: 'POST', body: fd });
    if (!r.ok) { const e = await r.json(); throw new Error(e.detail); }
    triggerDownload(await r.blob(), fname.endsWith('.pdf') ? fname : fname + '.pdf');
    setStatus(`Done! ${pagesList.length} pages merged.`, 'ok');
  } catch (e) { setStatus('Error: ' + e.message, 'err'); }
  btn.innerHTML = _MERGE_BTN_HTML;
  btn.disabled = false;
}

// ── EXTRACT / SPLIT ───────────────────────────────────────────────────────────
export async function decryptFile(f) {
  const fd = new FormData();
  fd.append('file', f.fileObj);
  fd.append('password', S.filePasswords[f.id] || '');
  fd.append('key', f.key || '');
  try {
    const r = await fetch('/decrypt', { method: 'POST', body: fd });
    if (!r.ok) { const e = await r.json(); throw new Error(e.detail); }
    triggerDownload(await r.blob(), f.filename.replace('.pdf', '_decrypted.pdf'));
  } catch (e) { setStatus('Decrypt failed: ' + e.message, 'err'); }
}

export async function extractSelected(f, fmt, selIndices) {
  const btn = document.getElementById('modal-extract-btn');
  const origHTML = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>'; }
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
  finally { if (btn && origHTML) { btn.innerHTML = origHTML; btn.disabled = false; } }
}

export async function splitEvery(f, n, fmt) {
  setModalStatus(`Splitting into ${n}-page chunks…`, 'loading');
  const origIndices = f.pages.map(p => p.origIdx);
  const rotMap = {};
  f.pages.forEach((p, pos) => { if (p.rotation) rotMap[pos] = p.rotation; });
  const fd = new FormData();
  fd.append('file', f.fileObj); fd.append('page_indices', JSON.stringify(origIndices));
  fd.append('rotations', JSON.stringify(rotMap)); fd.append('as_images', 'false');
  fd.append('image_format', 'jpeg'); fd.append('password', S.filePasswords[f.id] || '');
  fd.append('key', f.key || ''); fd.append('split_every', String(n));
  const btn2 = document.querySelector('#split-every-n + * + button, .mfoot-row button.mfbtn.ghost');
  try {
    const r = await fetch('/split', { method: 'POST', body: fd });
    if (!r.ok) { const e = await r.json(); throw new Error(e.detail); }
    triggerDownload(await r.blob(), f.filename.replace('.pdf', '') + `_every${n}.zip`);
    setModalStatus(`Split into ${Math.ceil(f.pages.length / n)} parts.`, 'ok');
  } catch (e) { setModalStatus('Error: ' + e.message, 'err'); }
}

export async function splitAllPages(f, fmt) {
  const origIndices = f.pages.map(p => p.origIdx);
  const rotMap = {};
  f.pages.forEach((p, pos) => { if (p.rotation) rotMap[pos] = p.rotation; });
  const btn = document.querySelector('.mfbtn.ghost:not(#modal-newcard-btn)');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>'; }
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
