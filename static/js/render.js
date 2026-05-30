import * as S from './state.js';
import { fmtSize, setModalStatus, checkSizeWarn, extractSelected, splitAllPages } from './api.js';

let _showUndoToast = () => {};
export function setShowUndoToast(fn) { _showUndoToast = fn; }
const showUndoToast = (...a) => _showUndoToast(...a);

export function renderGrid() {
  const grid  = document.getElementById('file-grid');
  const empty = document.getElementById('empty');
  const badge = document.getElementById('total-badge');
  const mBtn  = document.getElementById('merge-btn');
  grid.innerHTML = '';
  empty.style.display = S.files.length ? 'none' : 'flex';

  const totalPages = S.files.reduce((s, f) => s + f.pages.filter(p => p.include).length, 0);
  if (S.files.length) { badge.textContent = `${S.files.length} file${S.files.length > 1 ? 's' : ''} · ${totalPages} pg`; badge.classList.add('show'); }
  else badge.classList.remove('show');
  mBtn.disabled = totalPages < 1;

  let order = 1;
  S.files.forEach(file => {
    const card = document.createElement('div');
    card.className = 'fcard'; card.draggable = !file.loading; card.dataset.id = file.id;

    const thumb = file.loading
      ? `<div class="spinner"></div>`
      : file.error
        ? `<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="var(--red)" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>`
        : file.thumbs[0] ? `<img src="data:image/jpeg;base64,${file.thumbs[0]}" alt="cover">`
        : `<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1" style="opacity:.25"><path stroke-linecap="round" stroke-linejoin="round" d="M9 2H5a2 2 0 00-2 2v16a2 2 0 002 2h14a2 2 0 002-2V8l-6-6z"/><path d="M13 2v6h6"/></svg>`;

    const included  = file.pages.filter(p => p.include).length;
    const partial   = !file.loading && !file.error && included < file.total;
    const cardOrder = !file.loading && !file.error ? order++ : '';

    card.innerHTML = `
      <div class="fcard-thumb">
        ${thumb}
        ${cardOrder ? `<span class="fcard-order">${cardOrder}</span>` : ''}
        ${!file.loading && !file.error ? `<span class="pg-badge${partial ? ' partial' : ''}">${included}/${file.total}</span>` : ''}
        ${!file.loading && !file.error ? `<div class="fcard-hover">
          <button class="hover-open" onclick="window.openModal('${file.id}');event.stopPropagation()">Inspect</button>
          <button class="hover-del"  onclick="window.removeFileAction('${file.id}');event.stopPropagation()">Remove</button>
        </div>` : ''}
        ${file.error ? `<div class="fcard-hover"><button class="hover-del" onclick="window.removeFileAction('${file.id}');event.stopPropagation()">Remove</button></div>` : ''}
      </div>
      <div class="fcard-footer">
        <div class="fcard-name" title="${file.filename}">${file.filename}</div>
        ${file.size ? `<div class="fcard-size">${fmtSize(file.size)}</div>` : ''}
        ${file.error ? `<div class="fcard-size" style="color:var(--red)">Error loading</div>` : ''}
      </div>`;

    if (!file.loading && !file.error && file.thumbs.length > 1) {
      let t = null, ci = 0;
      const img = card.querySelector('img');
      card.addEventListener('mouseenter', () => { ci = 0; t = setInterval(() => { ci = (ci + 1) % Math.min(file.thumbs.length, 3); if (img) img.src = 'data:image/jpeg;base64,' + file.thumbs[ci]; }, 700); });
      card.addEventListener('mouseleave', () => { clearInterval(t); if (img) img.src = 'data:image/jpeg;base64,' + file.thumbs[0]; });
    }
    if (!file.loading) {
      card.addEventListener('dragstart', () => { S.setDragSrc(file.id); setTimeout(() => card.classList.add('dragging'), 0); });
      card.addEventListener('dragend',   () => { card.classList.remove('dragging'); clearCardDrag(); });
      card.addEventListener('dragover',  e => {
        e.preventDefault(); clearCardDrag();
        const after = e.clientX >= card.getBoundingClientRect().left + card.offsetWidth / 2;
        card.classList.add(after ? 'drop-after' : 'drop-before');
      });
      card.addEventListener('dragleave', () => clearCardDrag());
      card.addEventListener('drop', e => {
        e.preventDefault();
        const after = e.clientX >= card.getBoundingClientRect().left + card.offsetWidth / 2;
        clearCardDrag();
        if (!S.dragSrc || S.dragSrc === file.id) return;
        snapshot();
        const fi = S.files.findIndex(f => f.id === S.dragSrc);
        const ti = S.files.findIndex(f => f.id === file.id);
        if (fi < 0 || ti < 0) return;
        const [m] = S.files.splice(fi, 1);
        let insertAt = (fi < ti ? ti - 1 : ti) + (after ? 1 : 0);
        S.files.splice(Math.min(insertAt, S.files.length), 0, m);
        S.setDragSrc(null); renderGrid();
      });
    }
    grid.appendChild(card);
  });

  // end-zone: drop target after all cards for "append to end"
  if (S.files.some(f => !f.loading)) {
    const ez = document.createElement('div');
    ez.className = 'fcard-end-zone';
    ez.addEventListener('dragover',  e => { e.preventDefault(); ez.classList.add('active'); });
    ez.addEventListener('dragleave', ()  => ez.classList.remove('active'));
    ez.addEventListener('drop', e => {
      e.preventDefault(); ez.classList.remove('active');
      if (!S.dragSrc) return;
      snapshot();
      const fi = S.files.findIndex(f => f.id === S.dragSrc);
      if (fi < 0) return;
      const [m] = S.files.splice(fi, 1);
      S.files.push(m);
      S.setDragSrc(null); renderGrid();
    });
    grid.appendChild(ez);
  }

  renderPreview();
}

export function clearCardDrag() {
  document.querySelectorAll('.fcard').forEach(c => c.classList.remove('drag-over', 'drop-before', 'drop-after'));
}

export function renderPreview() {
  const pagesEl = document.getElementById('preview-pages');
  const empty   = document.getElementById('preview-empty');
  const count   = document.getElementById('preview-count');
  pagesEl.innerHTML = '';
  const items = [];
  S.files.forEach(f => {
    if (f.loading || f.error) return;
    f.pages.forEach((p, i) => { if (p.include) items.push({ file: f, pageIdx: i, rotation: p.rotation || 0 }); });
  });
  if (!items.length) { empty.style.display = 'flex'; count.textContent = ''; return; }
  empty.style.display = 'none';
  count.textContent = items.length + ' pg';

  // 2-column grid: panel 260px, padding 6px each side, gap 5px
  const colW = Math.floor((260 - 12 - 5) / 2); // ~121px
  const colH = Math.round(colW * 1.414);         // ~171px

  items.forEach((item, n) => {
    const rot = item.rotation, sideways = rot === 90 || rot === 270;
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `position:relative;width:${colW}px;height:${colH}px;overflow:hidden;border-radius:4px;border:1px solid var(--b1);flex-shrink:0`;
    const badge = document.createElement('div');
    badge.style.cssText = `position:absolute;bottom:3px;right:3px;background:rgba(0,0,0,.72);color:#999;font-size:.48rem;font-family:'DM Mono',monospace;padding:1px 4px;border-radius:4px;z-index:1;pointer-events:none;line-height:1.4`;
    badge.textContent = n + 1;
    const img = document.createElement('img');
    img.src = 'data:image/jpeg;base64,' + item.file.thumbs[item.pageIdx]; img.alt = '';
    img.style.cssText = sideways
      ? `position:absolute;top:50%;left:50%;width:${colH}px;height:${colW}px;object-fit:cover;transform:translate(-50%,-50%) rotate(${rot}deg)`
      : `display:block;width:${colW}px;height:${colH}px;object-fit:cover;` + (rot ? `transform:rotate(${rot}deg)` : '');
    wrapper.appendChild(img); wrapper.appendChild(badge);
    pagesEl.appendChild(wrapper);
  });
}

export function renderModalPages() {
  const file = S.files.find(f => f.id === S.modalFileId); if (!file) return;
  const grid = document.getElementById('modal-page-grid');
  grid.innerHTML = '';
  file.pages.forEach((pg, i) => {
    const card = document.createElement('div');
    const rot  = pg.rotation || 0;
    card.className  = 'mpage' + (S.modalSel.has(i) ? ' selected' : '');
    card.dataset.idx = i;
    const rs = rot ? `style="transform:rotate(${rot}deg);width:${rot === 180 ? '100%' : '72%'};margin:auto"` : '';
    card.innerHTML = `
      <div class="mpage-thumb">
        <img src="data:image/jpeg;base64,${file.thumbs[i]}" alt="p${i + 1}" ${rs}>
        <span class="rot-badge ${rot ? 'show' : ''}">${rot}°</span>
        <div class="mpage-check">✓</div>
      </div>
      <div class="mpage-actions">
        <button class="mpact" onclick="window.rotPage(${i},90);event.stopPropagation()" title="Rotate">↻</button>
        <button class="mpact" onclick="window.dupPage(${i});event.stopPropagation()" title="Duplicate">⧉</button>
        <button class="mpact" onclick="window.deletePage(${i});event.stopPropagation()" title="Remove" style="color:var(--red)">×</button>
      </div>
      <div class="mpage-label">p.${i + 1}${pg.dupOf !== undefined ? ' ⧉' : ''}</div>`;
    card.addEventListener('click', () => togglePageSel(i));
    card.draggable = true;
    card.addEventListener('dragstart', () => { S.setModalDragSrc(i); card.classList.add('dragging-pg'); });
    card.addEventListener('dragend',   () => { card.classList.remove('dragging-pg'); clearModalDrag(); });
    card.addEventListener('dragover',  e => { e.preventDefault(); clearModalDrag(); card.classList.add('drag-over-pg'); });
    card.addEventListener('dragleave', () => clearModalDrag());
    card.addEventListener('drop', e => {
      e.preventDefault(); clearModalDrag();
      if (S.modalDragSrc === null || S.modalDragSrc === i) return;
      snapshot();
      const [mp] = file.pages.splice(S.modalDragSrc, 1);
      const [mt] = file.thumbs.splice(S.modalDragSrc, 1);
      const newSel = new Set();
      S.modalSel.forEach(s => {
        if (s === S.modalDragSrc) newSel.add(i);
        else if (s > S.modalDragSrc && s <= i) newSel.add(s - 1);
        else if (s < S.modalDragSrc && s >= i) newSel.add(s + 1);
        else newSel.add(s);
      });
      S.setModalSel(newSel);
      file.pages.splice(i, 0, mp); file.thumbs.splice(i, 0, mt);
      S.setModalDragSrc(null); renderModalPages();
    });
    grid.appendChild(card);
  });
  updateModalCounts();
}

export function clearModalDrag() { document.querySelectorAll('.mpage').forEach(c => c.classList.remove('drag-over-pg')); }

export function togglePageSel(i) {
  if (S.modalSel.has(i)) S.modalSel.delete(i); else S.modalSel.add(i);
  document.querySelectorAll('.mpage')[i]?.classList.toggle('selected', S.modalSel.has(i));
  updateModalCounts();
}

export function updateModalCounts() {
  const n = S.modalSel.size;
  document.getElementById('sel-count').textContent = `${n} selected`;
  document.getElementById('modal-extract-btn').disabled = n === 0;
  document.getElementById('modal-remove-btn').disabled  = n === 0;
}

// undo helpers used by render
export function snapshot() {
  S.undoStack.push(S.files.map(f => ({ ...f, pages: f.pages.map(p => ({ ...p })) })));
  if (S.undoStack.length > 20) S.undoStack.shift();
}
