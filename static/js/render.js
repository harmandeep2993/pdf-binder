import * as S from './state.js';
import { fmtSize, setModalStatus, extractSelected, splitAllPages } from './api.js';

S.on('files:change', () => { renderGrid(); renderPreview(); });
S.on('modal:sel',    () => updateModalCounts());
S.on('ui:toast',     ({ msg }) => _showToast(msg));

let _showToast = () => {};
export function setShowToast(fn) { _showToast = fn; }

// ── LAZY IMAGE OBSERVER ───────────────────────────────────────────────────────
let _lazyObserver = null;
function getLazyObserver() {
  if (!_lazyObserver) {
    _lazyObserver = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting && e.target.dataset.src) {
          e.target.src = e.target.dataset.src;
          delete e.target.dataset.src;
          _lazyObserver.unobserve(e.target);
        }
      });
    }, { rootMargin: '80px' });
  }
  return _lazyObserver;
}

// ── GRID ──────────────────────────────────────────────────────────────────────
export function renderGrid() {
  const grid  = document.getElementById('file-grid');
  const empty = document.getElementById('empty');
  const badge = document.getElementById('total-badge');
  const mBtn  = document.getElementById('merge-btn');
  grid.innerHTML = '';
  empty.style.display = S.files.length ? 'none' : 'flex';

  const totalPages = S.files.reduce((s, f) => s + f.pages.filter(p => p.include).length, 0);
  if (S.files.length) {
    badge.textContent = `${S.files.length} file${S.files.length > 1 ? 's' : ''} · ${totalPages} pg`;
    badge.classList.add('show');
  } else badge.classList.remove('show');
  mBtn.disabled = totalPages < 1;

  // Selection toolbar
  renderSelectionBar();

  let order = 1;
  S.files.forEach(file => {
    const included    = file.pages.filter(p => p.include).length;
    const partial     = !file.loading && !file.error && included < file.total && included > 0;
    const allExcluded = !file.loading && !file.error && included === 0 && file.total > 0;
    const isSelected  = S.selectedCards.has(file.id);
    const cardOrder   = !file.loading && !file.error ? order++ : '';

    const card = document.createElement('div');
    card.className = 'fcard'
      + (allExcluded ? ' all-excluded' : '')
      + (isSelected  ? ' card-selected' : '');
    card.draggable = !file.loading; card.dataset.id = file.id;

    const thumb = file.loading
      ? `<div class="spinner"></div>`
      : file.error
        ? `<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="var(--red)" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>`
        : file.thumbs[0] ? `<img src="data:image/jpeg;base64,${file.thumbs[0]}" alt="cover">`
        : `<svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1" style="opacity:.25"><path stroke-linecap="round" stroke-linejoin="round" d="M9 2H5a2 2 0 00-2 2v16a2 2 0 002 2h14a2 2 0 002-2V8l-6-6z"/><path d="M13 2v6h6"/></svg>`;

    const pgBadgeClass = partial ? ' partial' : allExcluded ? ' none' : '';
    const progressBar  = file.loading && file.total > 0
      ? `<div class="fcard-progress"><div class="fcard-progress-fill" style="width:${file.progress||0}%"></div></div>`
      : '';

    card.innerHTML = `
      <div class="fcard-thumb">
        ${thumb}
        ${cardOrder ? `<span class="fcard-order">${cardOrder}</span>` : ''}
        ${!file.loading && !file.error ? `<span class="pg-badge${pgBadgeClass}">${allExcluded ? 'none' : `${included}/${file.total}`}</span>` : ''}
        ${!file.loading && !file.error ? `<div class="fcard-hover">
          <button class="hover-open" onclick="window.openModal('${file.id}');event.stopPropagation()">Inspect</button>
          <button class="hover-del"  onclick="window.removeFileAction('${file.id}');event.stopPropagation()">Remove</button>
        </div>` : ''}
        ${file.error ? `<div class="fcard-hover"><button class="hover-del" onclick="window.removeFileAction('${file.id}');event.stopPropagation()">Remove</button></div>` : ''}
        ${progressBar}
      </div>
      <div class="fcard-footer">
        <div class="fcard-name" title="${file.filename}">${file.filename}</div>
        ${file.size ? `<div class="fcard-meta">${fmtSize(file.size)}${file.total ? ` · ${file.total} pg` : ''}</div>` : ''}
        ${file.loading && file.total === 0 ? `<div class="fcard-meta" style="color:var(--mu2)">Loading…</div>` : ''}
        ${file.error ? `<div class="fcard-meta" style="color:var(--red)">Error loading</div>` : ''}
      </div>`;

    // hover thumbnail cycle
    if (!file.loading && !file.error && file.thumbs.length > 1) {
      let t = null, ci = 0;
      const img = card.querySelector('img');
      card.addEventListener('mouseenter', () => { ci = 0; t = setInterval(() => { ci = (ci+1) % Math.min(file.thumbs.length, 3); if (img) img.src = 'data:image/jpeg;base64,' + file.thumbs[ci]; }, 700); });
      card.addEventListener('mouseleave', () => { clearInterval(t); if (img) img.src = 'data:image/jpeg;base64,' + file.thumbs[0]; });
    }

    // keyboard
    if (!file.loading && !file.error) {
      card.setAttribute('tabindex', '0');
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.openModal(file.id); }
      });
    }

    // click: shift-select range, ctrl/meta: toggle, plain: open modal
    card.addEventListener('click', e => {
      if (!file.loading && !file.error) {
        if (e.shiftKey && S.lastCardId) {
          _selectRange(S.lastCardId, file.id); return;
        }
        if (e.ctrlKey || e.metaKey) {
          _toggleCardSelect(file.id); S.setLastCardId(file.id); return;
        }
        if (S.selectedCards.size > 0) {
          _toggleCardSelect(file.id); S.setLastCardId(file.id); return;
        }
        S.setLastCardId(file.id);
      }
    });

    if (!file.loading) {
      card.addEventListener('dragstart', () => {
        S.setDragSrc(file.id); S.setIsDragging(true);
        grid.classList.add('is-dragging');
        setTimeout(() => card.classList.add('dragging'), 0);
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging'); clearCardDrag();
        S.setIsDragging(false); grid.classList.remove('is-dragging');
      });
      card.addEventListener('dragover', e => {
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
        S.setDragSrc(null); S.filesChanged();
      });
    }
    grid.appendChild(card);
  });

  // end-zone
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
      S.setDragSrc(null); S.filesChanged();
    });
    grid.appendChild(ez);
  }
}

// ── CARD SELECTION ────────────────────────────────────────────────────────────
function _toggleCardSelect(id) {
  if (S.selectedCards.has(id)) S.selectedCards.delete(id);
  else S.selectedCards.add(id);
  S.filesChanged();
}

function _selectRange(fromId, toId) {
  const ids = S.files.filter(f => !f.loading && !f.error).map(f => f.id);
  const a = ids.indexOf(fromId), b = ids.indexOf(toId);
  if (a < 0 || b < 0) return;
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  ids.slice(lo, hi + 1).forEach(id => S.selectedCards.add(id));
  S.setLastCardId(toId);
  S.filesChanged();
}

function renderSelectionBar() {
  const existing = document.getElementById('sel-bar');
  if (!S.selectedCards.size) { existing?.remove(); return; }
  if (existing) { existing.querySelector('.sel-bar-count').textContent = `${S.selectedCards.size} selected`; return; }
  const bar = document.createElement('div');
  bar.id = 'sel-bar';
  bar.className = 'sel-bar';
  bar.innerHTML = `
    <span class="sel-bar-count">${S.selectedCards.size} selected</span>
    <button class="btn btn-ghost sel-bar-btn" onclick="window.removeSelectedCards()">Remove selected</button>
    <button class="btn btn-ghost sel-bar-btn" onclick="window.clearCardSelection()">Deselect</button>`;
  const canvas = document.getElementById('canvas');
  canvas.insertBefore(bar, canvas.firstChild);
}

export function clearCardSelection() { S.selectedCards.clear(); S.setLastCardId(null); S.filesChanged(); }
export function removeSelectedCards() {
  snapshot();
  S.selectedCards.forEach(id => { const f = S.files.find(f => f.id === id); if (f) window.abortLoad?.(id); });
  S.setFiles(S.files.filter(f => !S.selectedCards.has(f.id)));
  S.selectedCards.clear(); S.setLastCardId(null);
  S.emit('ui:toast', { msg: `${S.selectedCards.size || 'Cards'} removed` });
}

export function clearCardDrag() {
  document.querySelectorAll('.fcard').forEach(c => c.classList.remove('drag-over', 'drop-before', 'drop-after'));
}

// ── PREVIEW ───────────────────────────────────────────────────────────────────
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

  const thumbW = 268 - 20, thumbH = Math.round(thumbW * 1.414);
  const obs = getLazyObserver();

  items.forEach((item, n) => {
    const rot = item.rotation, sideways = rot === 90 || rot === 270;
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `position:relative;width:${thumbW}px;height:${thumbH}px;overflow:hidden;flex-shrink:0;border-radius:5px;border:1px solid var(--b1);box-shadow:0 2px 8px rgba(0,0,0,.25)`;
    const badge = document.createElement('div');
    badge.style.cssText = `position:absolute;bottom:5px;right:5px;background:rgba(0,0,0,.72);color:#aaa;font-size:.52rem;font-family:'DM Mono',monospace;padding:1px 6px;border-radius:5px;z-index:1;pointer-events:none`;
    badge.textContent = n + 1;
    const img = document.createElement('img');
    img.alt = '';
    // Lazy-load: first 4 immediately, rest via IntersectionObserver
    const src = 'data:image/jpeg;base64,' + item.file.thumbs[item.pageIdx];
    if (n < 4) { img.src = src; }
    else       { img.dataset.src = src; img.src = ''; obs.observe(img); }
    img.style.cssText = sideways
      ? `position:absolute;top:50%;left:50%;width:${thumbH}px;height:${thumbW}px;object-fit:cover;transform:translate(-50%,-50%) rotate(${rot}deg)`
      : `display:block;width:${thumbW}px;height:${thumbH}px;object-fit:cover;` + (rot ? `transform:rotate(${rot}deg)` : '');
    wrapper.appendChild(img); wrapper.appendChild(badge);
    pagesEl.appendChild(wrapper);
  });
}

// ── MODAL PAGES ───────────────────────────────────────────────────────────────
export function renderModalPages() {
  const file = S.files.find(f => f.id === S.modalFileId); if (!file) return;
  const grid = document.getElementById('modal-page-grid');
  grid.innerHTML = '';
  const obs = getLazyObserver();

  file.pages.forEach((pg, i) => {
    const card = document.createElement('div');
    const rot  = pg.rotation || 0;
    card.className   = 'mpage' + (S.modalSel.has(i) ? ' selected' : '');
    card.dataset.idx = i;
    const rs = rot ? `style="transform:rotate(${rot}deg);width:${rot===180?'100%':'72%'};margin:auto"` : '';

    // Use lazy-load for modal thumbnails — critical for large PDFs
    const src = 'data:image/jpeg;base64,' + file.thumbs[i];
    const imgTag = i < 8
      ? `<img src="${src}" alt="p${i+1}" ${rs}>`
      : `<img data-src="${src}" src="" alt="p${i+1}" ${rs} class="lazy-thumb">`;

    card.innerHTML = `
      <div class="mpage-thumb">
        ${imgTag}
        <span class="rot-badge ${rot ? 'show' : ''}">${rot}°</span>
        <div class="mpage-check">✓</div>
      </div>
      <div class="mpage-actions">
        <button class="mpact" onclick="window.rotPage(${i},90);event.stopPropagation()" title="Rotate">↻</button>
        <button class="mpact" onclick="window.dupPage(${i});event.stopPropagation()" title="Duplicate">⧉</button>
        <button class="mpact" onclick="window.deletePage(${i});event.stopPropagation()" title="Remove" style="color:var(--red)">×</button>
      </div>
      <div class="mpage-label">p.${i+1}${pg.dupOf!==undefined?' ⧉':''}</div>`;

    // Observe lazy images
    const lazyImg = card.querySelector('.lazy-thumb');
    if (lazyImg) obs.observe(lazyImg);

    card.addEventListener('click', () => togglePageSel(i));
    card.draggable = true;
    card.addEventListener('dragstart', () => { S.setModalDragSrc(i); card.classList.add('dragging-pg'); });
    card.addEventListener('dragend',   () => { card.classList.remove('dragging-pg'); clearModalDrag(); });
    card.addEventListener('dragover',  e => { e.preventDefault(); clearModalDrag(); card.classList.add('drag-over-pg'); });
    card.addEventListener('dragleave', () => clearModalDrag());
    card.addEventListener('drop', e => {
      e.preventDefault(); clearModalDrag();
      const src2 = S.modalDragSrc;
      if (src2 === null || src2 === i) return;
      snapshot();
      const [mp] = file.pages.splice(src2, 1);
      const [mt] = file.thumbs.splice(src2, 1);
      const insertAt = src2 < i ? i - 1 : i;
      const newSel = new Set();
      S.modalSel.forEach(s => {
        if (s === src2) newSel.add(insertAt);
        else if (src2 < insertAt && s > src2 && s <= insertAt) newSel.add(s - 1);
        else if (src2 > insertAt && s >= insertAt && s < src2) newSel.add(s + 1);
        else newSel.add(s);
      });
      S.setModalSel(newSel);
      file.pages.splice(insertAt, 0, mp);
      file.thumbs.splice(insertAt, 0, mt);
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

export function snapshot() {
  S.undoStack.push(S.files.map(f => ({ ...f, pages: f.pages.map(p => ({ ...p })) })));
  if (S.undoStack.length > 20) S.undoStack.shift();
}
