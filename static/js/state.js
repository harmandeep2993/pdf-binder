export let files        = [];
export let dragSrc      = null;
export let undoStack    = [];
export let undoTimer    = null;
export const filePasswords = {};   // file id -> password

export let modalFileId  = null;
export let modalSel     = new Set();
export let modalDragSrc = null;
export let pwResolve    = null;

export function setFiles(v)        { files        = v; }
export function setDragSrc(v)      { dragSrc      = v; }
export function setUndoTimer(v)    { undoTimer    = v; }
export function setModalFileId(v)  { modalFileId  = v; }
export function setModalSel(v)     { modalSel     = v; }
export function setModalDragSrc(v) { modalDragSrc = v; }
export function setPwResolve(v)    { pwResolve    = v; }
