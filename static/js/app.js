import * as S from './state.js';
import { loadFiles, checkSizeWarn, mergeFiles, extractSelected, splitAllPages, setStatus, setModalStatus, fmtSize, setPromptPassword } from './api.js';
import { renderGrid, renderPreview, renderModalPages, updateModalCounts, snapshot, togglePageSel, setShowUndoToast } from './render.js';

// ── PASSWORD ──
export function promptPassword(filename, showError) {
  return new Promise(resolve => {
    S.setPwResolve(resolve);
    document.getElementById('pw-filename').textContent = filename;
    document.getElementById('pw-input').value = '';
    document.getElementById('pw-err').classList.toggle('show', !!showError);
    document.getElementById('pw-overlay').classList.add('show');
    setTimeout(() => document.getElementById('pw-input').focus(), 80);
  });
}
function pwSubmit() {
  const val = document.getElementById('pw-input').value;
  document.getElementById('pw-overlay').classList.remove('show');
  if (S.pwResolve) { S.pwResolve(val); S.setPwResolve(null); }
}
function pwCancel() {
  document.getElementById('pw-overlay').classList.remove('show');
  if (S.pwResolve) { S.pwResolve(null); S.setPwResolve(null); }
}
document.getElementById('pw-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') pwSubmit();
  if (e.key === 'Escape') pwCancel();
});

// ── UNDO ──
export function showUndoToast(msg) {
  document.getElementById('undo-msg').textContent = msg;
  document.getElementById('undo-toast').classList.add('show');
  clearTimeout(S.undoTimer);
  S.setUndoTimer(setTimeout(hideUndoToast, 4000));
}
function hideUndoToast() { document.getElementById('undo-toast').classList.remove('show'); }
function doUndo() {
  if (!S.undoStack.length) return;
  S.setFiles(S.undoStack.pop());
  renderGrid(); hideUndoToast();
}

// ── MODAL ──
function openModal(fileId) {
  const file = S.files.find(f => f.id === fileId);
  if (!file || file.loading || file.error) return;
  S.setModalFileId(fileId);
  S.setModalSel(new Set(file.pages.map((p, i) => p.include ? i : -1).filter(i => i >= 0)));
  document.getElementById('modal-title').textContent = file.filename;
  document.getElementById('modal-sub').textContent   = `${file.total} page${file.total > 1 ? 's' : ''} · ${fmtSize(file.size)}`;
  renderModalPages();
  document.getElementById('modal-bg').classList.add('show');
}
function closeModal() {
  const file = S.files.find(f => f.id === S.modalFileId);
  if (file) { file.pages.forEach((p, i) => { p.include = S.modalSel.has(i); }); renderGrid(); renderPreview(); }
  document.getElementById('modal-bg').classList.remove('show');
  S.setModalFileId(null); S.setModalSel(new Set()); S.setModalDragSrc(null); setModalStatus('');
}
function getModalFile() { return S.files.find(f => f.id === S.modalFileId); }

function mSelectAll()    { const f=getModalFile();if(!f)return; f.pages.forEach((_,i)=>S.modalSel.add(i)); renderModalPages(); }
function mSelectNone()   { S.modalSel.clear(); renderModalPages(); }
function mSelectOdd()    { const f=getModalFile();if(!f)return; S.modalSel.clear(); f.pages.forEach((_,i)=>{if(i%2===0)S.modalSel.add(i);}); renderModalPages(); }
function mSelectEven()   { const f=getModalFile();if(!f)return; S.modalSel.clear(); f.pages.forEach((_,i)=>{if(i%2===1)S.modalSel.add(i);}); renderModalPages(); }
function mRotateSel(deg) { const f=getModalFile();if(!f)return; snapshot(); S.modalSel.forEach(i=>{f.pages[i].rotation=((f.pages[i].rotation||0)+deg)%360;}); renderModalPages(); }
function mDupSelected() {
  const f=getModalFile();if(!f||!S.modalSel.size)return; snapshot();
  const idxs=[...S.modalSel].sort((a,b)=>a-b);
  [...idxs].reverse().forEach(i=>{ f.pages.splice(i+1,0,{...f.pages[i],dupOf:i}); f.thumbs.splice(i+1,0,f.thumbs[i]); });
  const ns=new Set(); idxs.forEach(i=>ns.add(i+1)); S.setModalSel(ns); f.total=f.pages.length; renderModalPages();
  setTimeout(()=>{ document.querySelectorAll('.mpage').forEach((c,i)=>{if(ns.has(i))c.classList.add('dup-flash');}); },50);
}
function rotPage(i, deg) { const f=getModalFile();if(!f)return; snapshot(); f.pages[i].rotation=((f.pages[i].rotation||0)+deg)%360; renderModalPages(); }
function dupPage(i)      { const f=getModalFile();if(!f)return; snapshot(); f.pages.splice(i+1,0,{...f.pages[i],dupOf:i}); f.thumbs.splice(i+1,0,f.thumbs[i]); f.total=f.pages.length; renderModalPages(); }
function deletePage(i) {
  const f=getModalFile();if(!f)return; snapshot();
  f.pages.splice(i,1); f.thumbs.splice(i,1); f.total=f.pages.length;
  S.modalSel.delete(i);
  S.setModalSel(new Set([...S.modalSel].map(s=>s>i?s-1:s)));
  renderModalPages(); showUndoToast('Page removed');
}
function removeSelectedFromMerge() {
  const f=getModalFile();if(!f)return; snapshot();
  S.modalSel.forEach(i=>{if(f.pages[i])f.pages[i].include=false;});
  S.modalSel.clear(); renderModalPages(); renderGrid();
  setModalStatus('Pages excluded from merge.','ok'); showUndoToast('Pages excluded');
}
function removeFileAction(id) { snapshot(); S.setFiles(S.files.filter(f=>f.id!==id)); renderGrid(); checkSizeWarn(); showUndoToast('File removed'); }
function clearAll() { if(!S.files.length)return; snapshot(); S.setFiles([]); renderGrid(); checkSizeWarn(); showUndoToast('Cleared'); }

function doExtractSelected() {
  const f=getModalFile();if(!f||!S.modalSel.size)return;
  const fmt=document.getElementById('fmt-select').value;
  const indices=[...S.modalSel].sort((a,b)=>a-b);
  const rotMap={}; indices.forEach(i=>{if(f.pages[i].rotation)rotMap[i]=f.pages[i].rotation;});
  extractSelected(f,fmt,indices,rotMap);
}
function doSplitAllPages() {
  const f=getModalFile();if(!f)return;
  splitAllPages(f,document.getElementById('fmt-select').value);
}

// ── KEYBOARD ──
document.addEventListener('keydown', e => {
  if (document.getElementById('pw-overlay').classList.contains('show')) return;
  if (e.key === 'Escape') closeModal();
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); doUndo(); }
  if (document.getElementById('modal-bg').classList.contains('show')) {
    if (e.key === 'a' && !e.ctrlKey && !e.metaKey) mSelectAll();
    if (e.key === 'd') mSelectNone();
    if (e.key === 'Delete' || e.key === 'Backspace') removeSelectedFromMerge();
  }
});

// ── DRAG DROP ──
document.addEventListener('dragover', e => {
  e.preventDefault();
  document.getElementById('drop-overlay').classList.add('show');
  document.getElementById('empty-dropzone').classList.add('active');
});
document.addEventListener('dragleave', e => {
  if (!e.relatedTarget) {
    document.getElementById('drop-overlay').classList.remove('show');
    document.getElementById('empty-dropzone').classList.remove('active');
  }
});
document.addEventListener('drop', e => {
  e.preventDefault();
  document.getElementById('drop-overlay').classList.remove('show');
  document.getElementById('empty-dropzone').classList.remove('active');
  const pdfs = [...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (pdfs.length) loadFiles(pdfs);
});
document.getElementById('file-input').addEventListener('change', function () { loadFiles([...this.files]); this.value = ''; });
document.getElementById('merge-btn').addEventListener('click', mergeFiles);
document.getElementById('modal-bg').addEventListener('click', e => { if (e.target === document.getElementById('modal-bg')) closeModal(); });

// ── THEME ──
function initTheme() {
  const saved = localStorage.getItem('pf-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved === 'light' ? 'light' : '');
  updateThemeIcon(saved);
}
function toggleTheme() {
  const cur = localStorage.getItem('pf-theme') || 'dark';
  const next = cur === 'light' ? 'dark' : 'light';
  localStorage.setItem('pf-theme', next);
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

// ── WORKSPACE NAME ──
const wsInput = document.getElementById('workspace-name');
if (wsInput) {
  wsInput.value = localStorage.getItem('pf-workspace') || '';
  wsInput.addEventListener('input', () => localStorage.setItem('pf-workspace', wsInput.value));
}

// ── INIT ──
initTheme();

// ── INJECT CALLBACKS (break circular deps) ──
setPromptPassword(promptPassword);
setShowUndoToast(showUndoToast);

// ── EXPOSE GLOBALS (for inline handlers in dynamic HTML) ──
Object.assign(window, {
  openModal, closeModal, removeFileAction, clearAll, doUndo,
  pwSubmit, pwCancel,
  mSelectAll, mSelectNone, mSelectOdd, mSelectEven,
  mRotateSel, mDupSelected, rotPage, dupPage, deletePage,
  removeSelectedFromMerge, extractSelected: doExtractSelected, splitAllPages: doSplitAllPages,
});
