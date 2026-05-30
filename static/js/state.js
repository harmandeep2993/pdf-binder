// ── PUB/SUB ──────────────────────────────────────────────────────────────────
const _subs = {};

export function on(event, fn) {
  (_subs[event] ??= []).push(fn);
  return () => { _subs[event] = (_subs[event] || []).filter(s => s !== fn); };
}

export function emit(event, data) {
  (_subs[event] || []).forEach(fn => fn(data));
}

// ── STATE ─────────────────────────────────────────────────────────────────────
export let files        = [];
export let dragSrc      = null;
export let isDragging   = false;
export let undoStack    = [];
export let undoTimer    = null;
export const filePasswords  = {};   // file id -> password
export const controllers    = {};   // file id -> AbortController (in-flight loads)
export const selectedCards  = new Set(); // file ids selected on the grid

export let modalFileId  = null;
export let modalSel     = new Set();
export let modalDragSrc = null;
export let pwResolve    = null;
export let lastCardId   = null;     // last clicked card id (for shift-select range)

// ── SETTERS ───────────────────────────────────────────────────────────────────
export function setFiles(v)        { files = v;        emit('files:change'); }
export function filesChanged()     {                   emit('files:change'); }
export function setDragSrc(v)      { dragSrc = v; }
export function setIsDragging(v)   { isDragging = v; }
export function setUndoTimer(v)    { clearTimeout(undoTimer); undoTimer = v; }
export function setModalFileId(v)  { modalFileId = v; }
export function setModalSel(v)     { modalSel = v;     emit('modal:sel'); }
export function setModalDragSrc(v) { modalDragSrc = v; }
export function setPwResolve(v)    { pwResolve = v; }
export function setLastCardId(v)   { lastCardId = v; }
