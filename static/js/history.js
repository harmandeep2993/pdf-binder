function _fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function _fmtSize(b) {
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function _checkEmpty() {
  const container = document.getElementById('history-list');
  if (container && !container.querySelector('.hist-item')) renderHistory([]);
}

function renderHistory(records) {
  const container = document.getElementById('history-list');
  if (!container) return;
  if (!records.length) {
    container.innerHTML = `
      <div class="hist-empty">
        <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span>No merges yet - merged PDFs will appear here</span>
      </div>`;
    return;
  }
  container.innerHTML = '';
  records.forEach(rec => {
    const el = document.createElement('div');
    el.className = 'hist-item';
    el.dataset.id = rec.id;
    const srcText = rec.sources.slice(0, 3).join(', ')
      + (rec.sources.length > 3 ? ` +${rec.sources.length - 3} more` : '');

    el.innerHTML = `
      <div class="hist-icon">
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 2H5a2 2 0 00-2 2v16a2 2 0 002 2h14a2 2 0 002-2V8l-6-6z"/>
          <path stroke-linecap="round" stroke-linejoin="round" d="M13 2v6h6"/>
        </svg>
      </div>
      <div class="hist-info">
        <div class="hist-name"></div>
        <div class="hist-meta">${rec.pages} pages · ${_fmtSize(rec.size)} · ${_fmtDate(rec.created_at)}</div>
        <div class="hist-sources"></div>
      </div>
      <div class="hist-actions">
        <button class="hist-btn-open" title="Open in browser">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
          </svg>
          Open
        </button>
        <button class="hist-btn-dl" title="Download">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4-4 4m0 0-4-4m4 4V4"/>
          </svg>
        </button>
        <button class="hist-btn-del" title="Delete">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
          </svg>
        </button>
      </div>`;

    el.querySelector('.hist-name').textContent = rec.filename;
    el.querySelector('.hist-sources').textContent = 'From: ' + srcText;

    el.querySelector('.hist-btn-open').addEventListener('click', () => {
      window.open(`/history/${rec.id}/view`, '_blank');
    });

    el.querySelector('.hist-btn-dl').addEventListener('click', () => {
      window.location.href = `/history/${rec.id}/download`;
    });

    el.querySelector('.hist-btn-del').addEventListener('click', async function () {
      this.disabled = true;
      try {
        const r = await fetch(`/history/${rec.id}`, { method: 'DELETE' });
        if (!r.ok) throw new Error();
        el.classList.add('hist-removing');
        setTimeout(() => { el.remove(); _checkEmpty(); }, 280);
      } catch {
        this.disabled = false;
      }
    });

    container.appendChild(el);
  });
}

export async function loadHistory() {
  const container = document.getElementById('history-list');
  if (!container) return;
  container.innerHTML = '<div class="hist-empty" style="opacity:.5">Loading…</div>';
  try {
    const r = await fetch('/history');
    if (!r.ok) throw new Error();
    renderHistory(await r.json());
  } catch {
    container.innerHTML = '<div class="hist-empty" style="color:var(--red)">Failed to load history</div>';
  }
}
