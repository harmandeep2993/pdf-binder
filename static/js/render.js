import * as S from './state.js';
import { fmtSize } from './helpers.js';

S.on('files:change', () => { renderGrid(); renderModalPages(); renderPreview(); });
S.on('modal:sel',    () => { renderModalPages(); });
S.on('ui:toast',     ({ msg }) => _showToast(msg));

let _showToast = () => {};
export function setShowToast(fn) { _showToast = fn; }

// LAZY IMAGE OBSERVER
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
    }, { rootMargin: '200px' });
  }
  return _lazyObserver;
}

// UNDO
export function snapshot() {
  S.undoStack.push(S.files.map(f => ({ ...f, pages: f.pages.map(p => ({ ...p })) })));
  if (S.undoStack.length > 30) S.undoStack.shift();
}

// DRAG HELPERS
function clearDrag() {
  document.querySelectorAll('.fcard').forEach(c => c.classList.remove('drop-before', 'drop-after'));
}
function clearModalDrag() {
  document.querySelectorAll('.modal-page-card').forEach(c => c.classList.remove('drop-before', 'drop-after'));
}

// GRID (FILE CARDS)
export function renderGrid() {
  const grid = document.getElementById('file-grid');
  const empty = document.getElementById('empty');
  const badge = document.getElementById('total-badge');
  const mBtn = document.getElementById('merge-btn');

  grid.innerHTML = '';
  empty.style.display = S.files.length ? 'none' : 'flex';

  const totalIncluded = S.files.reduce((s, f) => s + f.pages.filter(p => p.include).length, 0);
  if (S.files.length) {
    badge.textContent = `${S.files.length} file${S.files.length > 1 ? 's' : ''} · ${totalIncluded} pg`;
    badge.classList.add('show');
  } else badge.classList.remove('show');
  mBtn.disabled = totalIncluded < 1;

  const obs = getLazyObserver();

  S.files.forEach((file, idx) => {
    const card = document.createElement('div');
    card.className = 'fcard' + (file.all_excluded ? ' all-excluded' : '');
    card.dataset.id = file.id;
    card.draggable = true;

    const inc = file.pages.filter(p => p.include).length;
    const badgeCls = file.loading || file.error ? '' :
      inc === 0 ? 'none' : inc < file.total ? 'partial' : '';

    card.innerHTML = `
      <div class="fcard-thumb">
        ${file.loading ? `<div class="spinner"></div>` : ''}
        ${!file.loading && !file.error && file.thumbs[0] ? `
          <img src="${file.thumbs[0]}" alt="thumb">
        ` : ''}
        ${!file.loading && !file.error && !file.thumbs[0] ? `<div class="pc-placeholder"></div>` : ''}
        ${file.error ? `<div style="color:var(--red);font-size:.7rem;text-align:center;width:100%">Error</div>` : ''}
      </div>
      <div class="fcard-order">${idx + 1}</div>
      ${badgeCls ? `<div class="pg-badge ${badgeCls}">${inc}/${file.total}</div>` : ''}
      <div class="fcard-hover">
        <button class="hover-open" onclick="openModal('${file.id}')">Inspect</button>
        <button class="hover-btn" onclick="duplicateCard('${file.id}')" title="Duplicate">⧉</button>
        ${S.filePasswords[file.id] ? `<button class="hover-btn" onclick="decryptCard('${file.id}')" style="color:var(--blue)" title="Download decrypted">🔓</button>` : ''}
        <button class="hover-btn danger" onclick="removeFileAction('${file.id}')" title="Remove">✕</button>
      </div>`;

    const img = card.querySelector('img');
    if (img && !img.src) obs.observe(img);

    // File drag
    card.addEventListener('dragstart', e => {
      S.setDragSrc(file.id);
      S.setIsDragging(true);
      setTimeout(() => card.classList.add('dragging'), 0);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      S.setDragSrc(null);
      S.setIsDragging(false);
      clearDrag();
    });
    card.addEventListener('dragover', e => {
      if (!S.dragSrc || S.dragSrc === file.id) return;
      e.preventDefault();
      clearDrag();
      const mid = card.getBoundingClientRect().left + card.offsetWidth / 2;
      card.classList.add(e.clientX < mid ? 'drop-before' : 'drop-after');
    });
    card.addEventListener('dragleave', () => clearDrag());
    card.addEventListener('drop', e => {
      clearDrag();
      if (!S.dragSrc || S.dragSrc === file.id) return;
      e.preventDefault();
      const after = e.clientX >= card.getBoundingClientRect().left + card.offsetWidth / 2;
      snapshot();
      const fi = S.files.findIndex(f => f.id === S.dragSrc);
      const ti = S.files.findIndex(f => f.id === file.id);
      if (fi < 0 || ti < 0) return;
      const [m] = S.files.splice(fi, 1);
      S.files.splice(Math.min((fi < ti ? ti - 1 : ti) + (after ? 1 : 0), S.files.length), 0, m);
      S.setDragSrc(null);
      S.filesChanged();
    });

    grid.appendChild(card);
  });
}

// MODAL PAGES
export function renderModalPages() {
  const container = document.getElementById('modal-page-grid');
  if (!container) return;
  const file = S.files.find(f => f.id === S.modalFileId);
  if (!file) { container.innerHTML = ''; return; }

  container.innerHTML = '';
  const obs = getLazyObserver();

  file.pages.forEach((pg, i) => {
    const rot = pg.rotation || 0;
    const sideways = rot === 90 || rot === 270;
    const selected = S.modalSel.has(i);

    const card = document.createElement('div');
    card.className = 'modal-page-card' + (selected ? ' selected' : '') + (!pg.include ? ' excluded' : '');
    card.dataset.idx = i;
    card.draggable = true;

    const src = file.thumbs[i] || '';
    const imgHTML = src
      ? (i < 8 ? `<img src="${src}" alt="p${i+1}">` : `<img data-src="${src}" src="" alt="p${i+1}" class="lazy-mpage">`)
      : `<div class="pc-placeholder"></div>`;

    card.innerHTML = `
      <div class="mpc-thumb">
        ${imgHTML}
        <div class="mpc-check">${selected ? '✓' : ''}</div>
        ${rot ? `<span class="mpc-rot">${rot}°</span>` : ''}
        ${pg.crop ? `<span class="mpc-crop">⊡</span>` : ''}
      </div>
      <div class="mpc-label">p.${i+1}</div>`;

    const lazy = card.querySelector('.lazy-mpage');
    if (lazy) obs.observe(lazy);

    if (rot && src) {
      const img = card.querySelector('img');
      if (img) img.style.cssText = sideways
        ? `position:absolute;top:50%;left:50%;width:133%;height:75%;object-fit:cover;transform:translate(-50%,-50%) rotate(${rot}deg)`
        : `display:block;width:100%;height:100%;object-fit:cover;transform:rotate(${rot}deg)`;
    }

    card.addEventListener('click', e => {
      if (e.ctrlKey || e.metaKey) {
        S.modalSel.has(i) ? S.modalSel.delete(i) : S.modalSel.add(i);
        S.setModalSel(S.modalSel);
      } else if (e.shiftKey) {
        const existing = [...S.modalSel];
        const from = existing.length ? Math.min(...existing) : i;
        const lo = Math.min(from, i), hi = Math.max(from, i);
        for (let j = lo; j <= hi; j++) S.modalSel.add(j);
        S.setModalSel(S.modalSel);
      } else {
        snapshot();
        pg.include = !pg.include;
        S.filesChanged();
      }
    });

    card.addEventListener('dragstart', e => {
      S.setModalDragSrc(i);
      setTimeout(() => card.classList.add('dragging'), 0);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      S.setModalDragSrc(null);
      clearModalDrag();
    });
    card.addEventListener('dragover', e => {
      if (S.modalDragSrc === null || S.modalDragSrc === i) return;
      e.preventDefault();
      clearModalDrag();
      const mid = card.getBoundingClientRect().left + card.offsetWidth / 2;
      card.classList.add(e.clientX < mid ? 'drop-before' : 'drop-after');
    });
    card.addEventListener('dragleave', () => clearModalDrag());
    card.addEventListener('drop', e => {
      clearModalDrag();
      const src = S.modalDragSrc;
      if (src === null || src === i) { S.setModalDragSrc(null); return; }
      const after = e.clientX >= card.getBoundingClientRect().left + card.offsetWidth / 2;
      e.preventDefault();
      snapshot();
      const [p] = file.pages.splice(src, 1);
      const [t] = file.thumbs.splice(src, 1);
      const at = (src < i ? i - 1 : i) + (after ? 1 : 0);
      file.pages.splice(Math.min(at, file.pages.length), 0, p);
      file.thumbs.splice(Math.min(at, file.thumbs.length), 0, t);
      S.setModalDragSrc(null);
      S.filesChanged();
    });

    container.appendChild(card);
  });

  _updateModalFooter();
}

function _updateModalFooter() {
  const n = S.modalSel.size;
  const f = S.files.find(x => x.id === S.modalFileId);
  const inc = f?.pages.filter(p => p.include).length || 0;
  document.getElementById('sel-count').textContent = n ? `${n} selected` : '';
  document.getElementById('modal-extract-btn').disabled = !n;
  document.getElementById('modal-remove-btn').disabled = !n;
  document.getElementById('modal-newcard-btn').disabled = !n;
}

// PREVIEW
export function renderPreview() {
  const pagesEl = document.getElementById('preview-pages');
  const empty = document.getElementById('preview-empty');
  const count = document.getElementById('preview-count');
  pagesEl.innerHTML = '';

  const items = [];
  S.files.forEach(f => {
    if (f.loading || f.error) return;
    f.pages.forEach((p, i) => { if (p.include) items.push({ file: f, pageIdx: i, rotation: p.rotation || 0 }); });
  });

  if (!items.length) { empty.style.display = 'flex'; count.textContent = ''; return; }
  empty.style.display = 'none';
  count.textContent = items.length + ' pg';

  const thumbW = 220, thumbH = Math.round(thumbW * 1.414);
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
    const src = item.file.thumbs[item.pageIdx];
    if (n < 4) { img.src = src; }
    else { img.dataset.src = src; img.src = ''; obs.observe(img); }
    img.style.cssText = sideways
      ? `position:absolute;top:50%;left:50%;width:${thumbH}px;height:${thumbW}px;object-fit:cover;transform:translate(-50%,-50%) rotate(${rot}deg)`
      : `display:block;width:${thumbW}px;height:${thumbH}px;object-fit:cover;` + (rot ? `transform:rotate(${rot}deg)` : '');
    wrapper.appendChild(img);
    wrapper.appendChild(badge);
    pagesEl.appendChild(wrapper);
  });
}
