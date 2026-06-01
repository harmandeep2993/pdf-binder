import './auth.js';   // must load first: patches fetch + shows the unlock overlay
import * as S from './state.js';
import { loadFiles, mergeFiles, extractSelected, splitAllPages, splitEvery,
         decryptFile, setStatus, setModalStatus, fmtSize, setPromptPassword, abortLoad } from './api.js';
import { renderGrid, renderModalPages, renderPreview, snapshot, setShowToast } from './render.js';
import { setStorage, getStorage, trapFocus } from './helpers.js';
import { setMergeMetadata } from './state.js';
import { loadHistory } from './history.js';

// ── ERROR BOUNDARY ────────────────────────────────────────────────────────────
window.addEventListener('error', e => {
  console.error('[PDF Binder] Uncaught error:', e.error);
  setStatus('Unexpected error — see console', 'err');
});
window.addEventListener('unhandledrejection', e => {
  console.error('[PDF Binder] Unhandled rejection:', e.reason);
  setStatus('Unexpected error — see console', 'err');
});

// ── TOAST ─────────────────────────────────────────────────────────────────────
function showUndoToast(msg) {
  document.getElementById('undo-msg').textContent = msg;
  document.getElementById('undo-toast').classList.add('show');
  S.setUndoTimer(setTimeout(() => document.getElementById('undo-toast').classList.remove('show'), 4000));
}
setShowToast(showUndoToast);

// ── PASSWORD MODAL ────────────────────────────────────────────────────────────
let _releasePwFocus = null;
export function promptPassword(filename, showError) {
  return new Promise(resolve => {
    S.setPwResolve(resolve);
    document.getElementById('pw-filename').textContent = filename;
    document.getElementById('pw-input').value = '';
    document.getElementById('pw-err').classList.toggle('show', !!showError);
    document.getElementById('pw-overlay').classList.add('show');
    _releasePwFocus = trapFocus(document.querySelector('.dialog'));
  });
}
function pwSubmit() {
  const val = document.getElementById('pw-input').value;
  document.getElementById('pw-overlay').classList.remove('show');
  _releasePwFocus?.(); _releasePwFocus = null;
  if (S.pwResolve) { S.pwResolve(val); S.setPwResolve(null); }
}
function pwCancel() {
  document.getElementById('pw-overlay').classList.remove('show');
  _releasePwFocus?.(); _releasePwFocus = null;
  if (S.pwResolve) { S.pwResolve(null); S.setPwResolve(null); }
}
document.getElementById('pw-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') pwSubmit();
  if (e.key === 'Escape') pwCancel();
});

// ── UNDO ──────────────────────────────────────────────────────────────────────
function doUndo() {
  if (!S.undoStack.length) return;
  S.setFiles(S.undoStack.pop());
  document.getElementById('undo-toast').classList.remove('show');
}

// ── FILE ACTIONS ──────────────────────────────────────────────────────────────
function removeFileAction(id) {
  snapshot(); abortLoad(id); S.setFiles(S.files.filter(f => f.id !== id));
  S.emit('ui:toast', { msg: 'File removed' });
}
function clearAll() {
  if (!S.files.length) return; snapshot();
  S.files.forEach(f => abortLoad(f.id));
  S.setFiles([]);
  S.emit('ui:toast', { msg: 'Cleared' });
}

// ── SORT CARDS ────────────────────────────────────────────────────────────────
function sortCards(by) {
  if (!S.files.length) return; snapshot();
  S.files.sort((a, b) => {
    if (by === 'name')  return a.filename.localeCompare(b.filename);
    if (by === 'pages') return (a.total || 0) - (b.total || 0);
    if (by === 'size')  return (a.size  || 0) - (b.size  || 0);
    return 0;
  });
  S.filesChanged();
}

// ── DUPLICATE CARD ────────────────────────────────────────────────────────────
function duplicateCard(id) {
  snapshot();
  const file = S.files.find(f => f.id === id); if (!file) return;
  const copy = { ...file, id: 'f_' + Date.now() + '_dup',
    pages: file.pages.map(p => ({...p})), thumbs: [...file.thumbs] };
  S.files.splice(S.files.findIndex(f => f.id === id) + 1, 0, copy);
  S.filesChanged(); S.emit('ui:toast', { msg: 'Card duplicated' });
}

// ── DECRYPT ───────────────────────────────────────────────────────────────────
function decryptCard(id) {
  const f = S.files.find(x => x.id === id); if (!f) return;
  decryptFile(f);
}

// ── BLANK PAGE ────────────────────────────────────────────────────────────────
function addBlankPage() {
  snapshot();
  S.files.push({
    id: 'blank_' + Date.now(), filename: 'Blank Page', type: 'blank',
    total: 1, thumbs: [''], size: 0, loading: false, error: null,
    pages: [{ include: true, rotation: 0, origIdx: 0, type: 'blank', width: 595, height: 842 }],
  });
  S.filesChanged(); S.emit('ui:toast', { msg: 'Blank page added' });
}

// ── ZOOM ──────────────────────────────────────────────────────────────────────
function zoomPage(fileId, pagePos) {
  const f = S.files.find(x => x.id === fileId); if (!f) return;
  const origIdx = f.pages[pagePos]?.origIdx ?? pagePos;
  const overlay = document.getElementById('zoom-overlay');
  const img = document.getElementById('zoom-img');
  const label = document.getElementById('zoom-label');
  img.src = ''; label.textContent = `p.${pagePos + 1}`;
  overlay.classList.add('show');
  img.src = f.key ? `/page-zoom/${f.key}/${origIdx}`
                  : (f.thumbs[pagePos] ? 'data:image/jpeg;base64,' + f.thumbs[pagePos] : '');
}
function closeZoom() { document.getElementById('zoom-overlay').classList.remove('show'); }

// ── CROP ──────────────────────────────────────────────────────────────────────
function openCrop() {
  if (!S.modalSel.size) { S.emit('ui:toast', { msg: 'Select pages to crop' }); return; }
  ['crop-l','crop-r','crop-t','crop-b'].forEach(id => { document.getElementById(id).value = '0'; });
  document.getElementById('crop-overlay').classList.add('show');
}
function closeCrop() { document.getElementById('crop-overlay').classList.remove('show'); }
function applyCrop() {
  const MM = 2.8346;
  const l = parseFloat(document.getElementById('crop-l').value || 0) * MM;
  const r = parseFloat(document.getElementById('crop-r').value || 0) * MM;
  const t = parseFloat(document.getElementById('crop-t').value || 0) * MM;
  const b = parseFloat(document.getElementById('crop-b').value || 0) * MM;
  if (!l && !r && !t && !b) { closeCrop(); return; }
  snapshot();
  const f = S.files.find(x => x.id === S.modalFileId);
  if (f) S.modalSel.forEach(i => { if (f.pages[i]) f.pages[i].crop = { l, r, t, b }; });
  closeCrop();
  S.emit('ui:toast', { msg: `Crop applied to ${S.modalSel.size} page(s)` });
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function openModal(id) {
  const file = S.files.find(f => f.id === id); if (!file) return;
  S.setModalFileId(id);
  S.setModalSel(new Set());
  S.setModalDragSrc(null);
  S.setModalFocusIdx(-1);
  document.getElementById('modal-title').textContent = file.filename;
  document.getElementById('modal-sub').textContent = file.total + ' pages';
  document.getElementById('modal-bg').classList.add('show');
  renderModalPages();
  document.getElementById('page-range-input').value = '';
}
function closeModal() {
  S.setModalFileId(null);
  S.setModalSel(new Set());
  S.setModalDragSrc(null);
  S.setModalFocusIdx(-1);
  document.getElementById('modal-bg').classList.remove('show');
}
function mSelectAll() {
  const f = S.files.find(x => x.id === S.modalFileId); if (!f) return;
  S.setModalSel(new Set(f.pages.map((_, i) => i)));
}
function mSelectNone() { S.setModalSel(new Set()); }
function mSelectOdd() {
  const f = S.files.find(x => x.id === S.modalFileId); if (!f) return;
  const s = new Set();
  f.pages.forEach((_, i) => { if (i % 2 === 0) s.add(i); });
  S.setModalSel(s);
}
function mSelectEven() {
  const f = S.files.find(x => x.id === S.modalFileId); if (!f) return;
  const s = new Set();
  f.pages.forEach((_, i) => { if (i % 2 === 1) s.add(i); });
  S.setModalSel(s);
}
function mRotateSel(deg) {
  if (!S.modalSel.size) return;
  snapshot();
  const f = S.files.find(x => x.id === S.modalFileId);
  if (f) S.modalSel.forEach(i => {
    const p = f.pages[i];
    if (deg === 90) p.rotation = ((p.rotation || 0) + 90) % 360;
    else if (deg === 180) p.rotation = ((p.rotation || 0) + 180) % 360;
    else if (deg === 270) p.rotation = ((p.rotation || 0) + 270) % 360;
  });
  S.filesChanged();
}
function mDupSelected() {
  if (!S.modalSel.size) return;
  snapshot();
  const f = S.files.find(x => x.id === S.modalFileId); if (!f) return;
  const idxs = [...S.modalSel].sort((a,b) => b - a);
  idxs.forEach(i => {
    f.pages.splice(i + 1, 0, { ...f.pages[i], dupOf: i });
    f.thumbs.splice(i + 1, 0, f.thumbs[i]);
  });
  f.total = f.pages.length;
  S.filesChanged();
}
function removeSelectedFromMerge() {
  if (!S.modalSel.size) return;
  snapshot();
  const f = S.files.find(x => x.id === S.modalFileId);
  if (f) S.modalSel.forEach(i => { f.pages[i].include = false; });
  S.filesChanged();
}
function extractToNewCard() {
  if (!S.modalSel.size) return;
  snapshot();
  const f = S.files.find(x => x.id === S.modalFileId); if (!f) return;
  const idxs = [...S.modalSel].sort((a, b) => a - b);
  const newPages = idxs.map(i => ({ ...f.pages[i] }));
  const newThumbs = idxs.map(i => f.thumbs[i] || '');
  const newFile = { ...f, id: 'f_' + Date.now() + '_x', pages: newPages, thumbs: newThumbs, total: newPages.length };
  [...idxs].reverse().forEach(i => { f.pages.splice(i, 1); f.thumbs.splice(i, 1); });
  f.total = f.pages.length;
  const origIdx = S.files.findIndex(x => x.id === S.modalFileId);
  S.files.splice(origIdx + 1, 0, newFile);
  S.filesChanged();
  S.emit('ui:toast', { msg: 'Selected pages moved to new card' });
}
function applyPageRange() {
  const input = document.getElementById('page-range-input').value.trim();
  if (!input) return;
  S.setModalSel(new Set());
  const parts = input.split(',');
  parts.forEach(part => {
    part = part.trim();
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(x => parseInt(x.trim()) - 1);
      const lo = Math.min(a, b), hi = Math.max(a, b);
      for (let i = lo; i <= hi; i++) S.modalSel.add(i);
    } else {
      const idx = parseInt(part) - 1;
      if (idx >= 0) S.modalSel.add(idx);
    }
  });
  S.setModalSel(S.modalSel);
}
function doExtract() {
  const f = S.files.find(x => x.id === S.modalFileId); if (!f || !S.modalSel.size) return;
  const fmt = document.getElementById('fmt-select').value;
  extractSelected(f, fmt, [...S.modalSel]);
}
function doSplitAll() {
  const f = S.files.find(x => x.id === S.modalFileId); if (!f) return;
  const fmt = document.getElementById('fmt-select').value;
  splitAllPages(f, fmt);
}
function doSplitEvery() {
  const n = parseInt(document.getElementById('split-every-n').value || 2);
  if (n < 1 || !S.modalFileId) return;
  const f = S.files.find(x => x.id === S.modalFileId); if (!f) return;
  splitEvery(f, n);
}

// ── SETTINGS MODAL ────────────────────────────────────────────────────────────
function openSettings() { _refreshPresetSelect(); document.getElementById('settings-overlay').classList.add('show'); }
function closeSettings() { document.getElementById('settings-overlay').classList.remove('show'); }

function _getAllSettings() {
  const g = id => document.getElementById(id);
  return {
    compress: g('compress-toggle')?.checked, pageNumbers: g('pagenums-toggle')?.checked,
    normalize: g('normalize-toggle')?.checked, grayscale: g('grayscale-toggle')?.checked,
    bookmarks: g('bookmarks-toggle')?.checked, flatten: g('flatten-toggle')?.checked,
  };
}
function _applySettings(s) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
  set('compress-toggle', s.compress); set('pagenums-toggle', s.pageNumbers);
  set('normalize-toggle', s.normalize); set('grayscale-toggle', s.grayscale);
  set('bookmarks-toggle', s.bookmarks ?? true); set('flatten-toggle', s.flatten);
}
function _getPresets() { try { return JSON.parse(getStorage('pf-presets', '{}')); } catch { return {}; } }
function _refreshPresetSelect() {
  const sel = document.getElementById('preset-select'); if (!sel) return;
  const presets = _getPresets();
  sel.innerHTML = '<option value="">— select preset —</option>';
  Object.keys(presets).forEach(name => {
    const o = document.createElement('option'); o.value = name; o.textContent = name; sel.appendChild(o);
  });
}
function savePreset() {
  const name = prompt('Preset name:'); if (!name?.trim()) return;
  const presets = _getPresets(); presets[name.trim()] = _getAllSettings();
  setStorage('pf-presets', JSON.stringify(presets)); _refreshPresetSelect();
  S.emit('ui:toast', { msg: `Preset "${name.trim()}" saved` });
}
function applyPreset() {
  const sel = document.getElementById('preset-select'); const name = sel?.value; if (!name) return;
  const p = _getPresets(); if (p[name]) { _applySettings(p[name]); S.emit('ui:toast', { msg: `"${name}" applied` }); }
}
function deletePreset() {
  const sel = document.getElementById('preset-select'); const name = sel?.value; if (!name) return;
  const p = _getPresets(); delete p[name]; setStorage('pf-presets', JSON.stringify(p));
  _refreshPresetSelect(); S.emit('ui:toast', { msg: 'Preset deleted' });
}

// ── METADATA MODAL ────────────────────────────────────────────────────────────
let _releaseMetaFocus = null;
function openMetaModal() {
  document.getElementById('meta-title').value = S.mergeMetadata.title || '';
  document.getElementById('meta-author').value = S.mergeMetadata.author || '';
  document.getElementById('meta-subject').value = S.mergeMetadata.subject || '';
  document.getElementById('meta-overlay').classList.add('show');
  _releaseMetaFocus = trapFocus(document.querySelector('#meta-overlay .dialog'));
}
function closeMetaModal() {
  document.getElementById('meta-overlay').classList.remove('show');
  _releaseMetaFocus?.(); _releaseMetaFocus = null;
}
function metaSubmit() {
  setMergeMetadata({
    title: document.getElementById('meta-title').value.trim(),
    author: document.getElementById('meta-author').value.trim(),
    subject: document.getElementById('meta-subject').value.trim(),
  });
  closeMetaModal();
  const hasAny = S.mergeMetadata.title || S.mergeMetadata.author || S.mergeMetadata.subject;
  const btn = document.getElementById('meta-btn');
  btn?.classList.toggle('has-meta', !!hasAny);
  if (hasAny) S.emit('ui:toast', { msg: 'Metadata saved' });
}

// ── HELP MODAL ────────────────────────────────────────────────────────────────
function openHelp() { document.getElementById('help-overlay').classList.add('show'); }
function closeHelp() { document.getElementById('help-overlay').classList.remove('show'); }

// ── KEYBOARD ──────────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (document.getElementById('pw-overlay').classList.contains('show')) return;
  if (e.key === 'Escape') {
    if (document.getElementById('modal-bg').classList.contains('show')) { closeModal(); return; }
    if (document.getElementById('zoom-overlay').classList.contains('show')) { closeZoom(); return; }
    if (document.getElementById('help-overlay').classList.contains('show')) { closeHelp(); return; }
    if (document.getElementById('settings-overlay').classList.contains('show')) { closeSettings(); return; }
    if (document.getElementById('meta-overlay').classList.contains('show')) { closeMetaModal(); return; }
    if (document.getElementById('crop-overlay').classList.contains('show')) { closeCrop(); return; }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); doUndo(); }
  if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); openHelp(); }
  if (e.key === 'Enter' && !document.activeElement?.classList.contains('dinput')) {
    const focused = document.activeElement?.closest('.fcard');
    if (focused) { openModal(focused.dataset.id); e.preventDefault(); }
  }
});

// ── DRAG DROP (file upload) ───────────────────────────────────────────────────
document.addEventListener('dragover', e => {
  if (S.isDragging) return;
  e.preventDefault();
  document.getElementById('drop-overlay').classList.add('show');
  document.getElementById('empty-dropzone')?.classList.add('active');
});
document.addEventListener('dragleave', e => {
  if (!e.relatedTarget) {
    document.getElementById('drop-overlay').classList.remove('show');
    document.getElementById('empty-dropzone')?.classList.remove('active');
  }
});
document.addEventListener('drop', e => {
  document.getElementById('drop-overlay').classList.remove('show');
  document.getElementById('empty-dropzone')?.classList.remove('active');
  if (S.isDragging) return;
  e.preventDefault();
  const pdfs = [...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (pdfs.length) loadFiles(pdfs);
});
document.getElementById('file-input').addEventListener('change', function () { loadFiles([...this.files]); this.value = ''; });
document.getElementById('merge-btn').addEventListener('click', mergeFiles);

// ── TAB SWITCHER ──────────────────────────────────────────────────────────────
function switchTab(tab) {
  const isMerge = tab === 'merge';
  document.getElementById('main-layout').style.display = isMerge ? 'flex' : 'none';
  document.getElementById('history-view').style.display = isMerge ? 'none' : 'flex';
  document.getElementById('tab-merge').classList.toggle('active', isMerge);
  document.getElementById('tab-history').classList.toggle('active', !isMerge);
  document.getElementById('toolbar-merge-actions').style.display = isMerge ? 'contents' : 'none';
  if (!isMerge) loadHistory();
}

// ── THEME ─────────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = getStorage('pf-theme', 'dark');
  document.documentElement.setAttribute('data-theme', saved === 'light' ? 'light' : '');
  updateThemeIcon(saved);
}
function toggleTheme() {
  const next = getStorage('pf-theme', 'dark') === 'light' ? 'dark' : 'light';
  setStorage('pf-theme', next);
  document.documentElement.setAttribute('data-theme', next === 'light' ? 'light' : '');
  updateThemeIcon(next);
}
function updateThemeIcon(theme) {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  btn.innerHTML = theme === 'light'
    ? `<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`
    : `<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path stroke-linecap="round" d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
}
document.getElementById('theme-btn')?.addEventListener('click', toggleTheme);

// ── INIT ──────────────────────────────────────────────────────────────────────
initTheme();
setPromptPassword(promptPassword);

// ── EXPOSE GLOBALS ────────────────────────────────────────────────────────────
Object.assign(window, {
  removeFileAction, clearAll, sortCards, duplicateCard, decryptCard, addBlankPage, doUndo,
  pwSubmit, pwCancel,
  openModal, closeModal,
  mSelectAll, mSelectNone, mSelectOdd, mSelectEven,
  mRotateSel, mDupSelected, removeSelectedFromMerge, extractToNewCard,
  applyPageRange, doSplitEvery, doExtract, doSplitAll,
  zoomPage, closeZoom, openCrop, closeCrop, applyCrop,
  openSettings, closeSettings, savePreset, applyPreset, deletePreset,
  openMetaModal, closeMetaModal, metaSubmit,
  openHelp, closeHelp,
  switchTab,
  extractSelected, splitAllPages,
});
