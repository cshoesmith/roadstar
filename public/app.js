/* public/app.js — Roadstar Autoparts shop frontend */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let allItems      = [];
let filteredItems = [];let activeCategory = 'All';let currentImages = [];
let currentIndex  = 0;
let currentItem   = null;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const grid        = document.getElementById('grid');
const categoryBar = document.getElementById('categoryBar');
const searchInput = document.getElementById('searchInput');
const searchBtn   = document.getElementById('searchBtn');
const sortSelect  = document.getElementById('sortSelect');
const itemCount   = document.getElementById('itemCount');
const emptyState  = document.getElementById('emptyState');
const modal       = document.getElementById('modal');
const modalOverlay  = document.getElementById('modalOverlay');
const modalClose    = document.getElementById('modalClose');
const galleryMain   = document.getElementById('galleryMainImg');
const gallerySpinner = document.getElementById('gallerySpinner');
const galleryThumbs  = document.getElementById('galleryThumbs');
const galleryPrev    = document.getElementById('galleryPrev');
const galleryNext    = document.getElementById('galleryNext');
const modalLoader   = document.getElementById('modalLoader');
const modalContent  = document.getElementById('modalContent');
const modalError    = document.getElementById('modalError');

// ── Utilities ────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parsePrice(str) {
  const m = String(str || '').match(/[\d,.]+/);
  return m ? parseFloat(m[0].replace(/,/g, '')) : 0;
}

function sizeUrl(url, size) {
  return String(url || '').replace(/s-l\d+(\.\w+)?$/, `s-l${size}$1`);
}

// ── Category tabs ─────────────────────────────────────────────────────────────
const CAT_ICONS = {
  'All':          '🔧',
  'Engine':       '🔧',
  'Exhaust':      '💨',
  'Electrical':   '⚡',
  'Cooling':      '🌡️',
  'Fuel & Air':   '⛽',
  'Transmission': '⚙️',
  'Brakes':       '🛑',
  'Steering':     '🛠️',
  'Wheels/Tyres': '🛞',
  'Body & Trim':  '🚗',
  'Other':        '📦',
};

function renderCategoryTabs(items) {
  const counts = { All: items.length };
  for (const item of items) {
    const c = item.category || 'Other';
    counts[c] = (counts[c] || 0) + 1;
  }
  const cats = ['All', ...Object.keys(counts).filter(c => c !== 'All').sort()];

  categoryBar.innerHTML = cats.map(cat => `
    <button
      class="cat-tab${cat === activeCategory ? ' active' : ''}"
      data-cat="${esc(cat)}"
      role="tab"
      aria-selected="${cat === activeCategory}"
    >${CAT_ICONS[cat] ?? '🔧'} ${esc(cat)} <span class="cat-count">${counts[cat]}</span></button>
  `).join('');

  categoryBar.querySelectorAll('.cat-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat;
      applyFilters();
      renderCategoryTabs(allItems);
    });
  });
}

// ── Data loading ──────────────────────────────────────────────────────────────
async function loadItems() {
  try {
    const res = await fetch('/api/items');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allItems = await res.json();
    renderCategoryTabs(allItems);
    applyFilters();
  } catch (err) {
    itemCount.textContent = 'Failed to load items.';
    console.error('loadItems:', err);
  }
}

// ── Grid rendering ────────────────────────────────────────────────────────────
function getSorted(items) {
  const copy = [...items];
  switch (sortSelect.value) {
    case 'price-asc':  copy.sort((a, b) => parsePrice(a.price) - parsePrice(b.price)); break;
    case 'price-desc': copy.sort((a, b) => parsePrice(b.price) - parsePrice(a.price)); break;
    case 'name-asc':   copy.sort((a, b) => a.title.localeCompare(b.title)); break;
  }
  return copy;
}

function renderGrid() {
  const items = getSorted(filteredItems);
  itemCount.textContent = `${items.length} item${items.length !== 1 ? 's' : ''}`;

  if (items.length === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  grid.innerHTML = items.map(item => `
    <div class="card" data-id="${esc(item.id)}" tabindex="0" role="button"
         aria-label="${esc(item.title)}">
      <div class="card-img-wrap">
        <img
          src="${esc(sizeUrl(item.imageUrl, '300'))}"
          alt="${esc(item.title)}"
          loading="lazy"
          onerror="this.style.opacity='0'"
        />
      </div>
      <div class="card-body">
        <p class="card-title">${esc(item.title)}</p>
        <p class="card-price">${esc(item.price)}</p>
        <div class="card-meta">
          <span class="card-condition">${esc(item.condition || 'Brand New')}</span>
          ${item.category ? `<span class="card-cat-badge">${esc(item.category)}</span>` : ''}
        </div>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click',   () => openModal(card.dataset.id));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openModal(card.dataset.id);
      }
    });
  });
}

// ── Combined filter (category + search) ────────────────────────────────────────────
function applyFilters() {
  const q = searchInput.value.trim().toLowerCase();
  filteredItems = allItems.filter(i => {
    const matchesCat  = activeCategory === 'All' || (i.category || 'Other') === activeCategory;
    const matchesText = !q || i.title.toLowerCase().includes(q);
    return matchesCat && matchesText;
  });
  renderGrid();
}

// ── Search & filter ───────────────────────────────────────────────────────────────────────
function applySearch(q) {
  applyFilters();
}

searchBtn.addEventListener('click',  () => applySearch(searchInput.value));
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') applySearch(searchInput.value);
});
searchInput.addEventListener('input', () => {
  if (searchInput.value === '') applySearch('');
});
sortSelect.addEventListener('change', renderGrid);

// ── Modal open ────────────────────────────────────────────────────────────────
async function openModal(id) {
  currentItem = allItems.find(i => i.id === id);
  if (!currentItem) return;

  // Reset states
  modalLoader.classList.remove('hidden');
  modalContent.classList.add('hidden');
  modalError.classList.add('hidden');
  galleryThumbs.innerHTML = '';

  // Show the card thumbnail immediately while details load
  currentImages  = [sizeUrl(currentItem.imageUrl, '500')];
  currentIndex   = 0;
  showImage(0, /* fromLoad */ true);
  updateNavButtons();

  // Open modal
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  modalClose.focus();

  // Fetch full item details from our server proxy
  try {
    const res = await fetch(`/api/item/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    populateModal(data);
  } catch (err) {
    console.warn('Modal detail fetch failed:', err.message);
    populateFallback(currentItem);
  }
}

// ── Modal populate ────────────────────────────────────────────────────────────
function populateModal(data) {
  // Gallery — use fetched images if available
  if (data.images && data.images.length > 0) {
    currentImages = data.images;
    currentIndex  = 0;
    showImage(0);
    renderThumbs();
    updateNavButtons();
  }

  document.getElementById('modalTitle').textContent =
    data.title || currentItem.title;

  document.getElementById('modalPrice').textContent =
    data.price || currentItem.price;

  document.getElementById('modalCondition').textContent =
    data.condition || currentItem.condition || 'Brand New';

  // Item specifics
  const tbody = document.getElementById('specificsBody');
  tbody.innerHTML = '';
  const skip = new Set(['UPC', 'MPN', 'Manufacturer Part Number', 'Mpn']);
  const entries = Object.entries(data.specifics || {}).filter(([k]) => !skip.has(k));

  const section = document.getElementById('specificsSection');
  if (entries.length) {
    entries.forEach(([k, v]) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(k)}</td><td>${esc(v)}</td>`;
      tbody.appendChild(tr);
    });
    section.classList.remove('hidden');
  } else {
    section.classList.add('hidden');
  }

  // Postage & location
  const shippingSection = document.getElementById('shippingSection');
  const postageEl  = document.getElementById('modalPostage');
  const locationEl = document.getElementById('modalLocation');
  postageEl.textContent  = data.postage  ? `Postage: ${data.postage}`   : '';
  locationEl.textContent = data.location ? `Location: ${data.location}` : '';
  shippingSection.classList.toggle(
    'hidden', !data.postage && !data.location
  );

  document.getElementById('modalEbayBtn').href = currentItem.listingUrl;

  modalLoader.classList.add('hidden');
  modalContent.classList.remove('hidden');
}

function populateFallback(item) {
  document.getElementById('modalTitle').textContent    = item.title;
  document.getElementById('modalPrice').textContent    = item.price;
  document.getElementById('modalCondition').textContent = item.condition || 'Brand New';
  document.getElementById('specificsSection').classList.add('hidden');
  document.getElementById('shippingSection').classList.add('hidden');
  document.getElementById('modalEbayBtn').href = item.listingUrl;

  modalLoader.classList.add('hidden');
  modalContent.classList.remove('hidden');

  // Show soft error note
  document.getElementById('modalFallbackLink').href = item.listingUrl;
  // don't show the error panel — we still show basic info
}

// ── Gallery helpers ───────────────────────────────────────────────────────────
function showImage(idx, instant = false) {
  if (!instant) gallerySpinner.classList.remove('hidden');

  galleryMain.onload  = () => gallerySpinner.classList.add('hidden');
  galleryMain.onerror = () => gallerySpinner.classList.add('hidden');
  galleryMain.src     = currentImages[idx] || '';

  document.querySelectorAll('.gallery-thumbs img').forEach((img, i) => {
    img.classList.toggle('active', i === idx);
  });
}

function renderThumbs() {
  galleryThumbs.innerHTML = currentImages
    .map((src, i) => `<img
      src="${esc(sizeUrl(src, '140'))}"
      class="${i === 0 ? 'active' : ''}"
      alt="Thumbnail ${i + 1}"
    />`)
    .join('');

  galleryThumbs.querySelectorAll('img').forEach((img, i) => {
    img.addEventListener('click', () => {
      currentIndex = i;
      showImage(i);
      updateNavButtons();
    });
  });
}

function updateNavButtons() {
  galleryPrev.disabled = currentIndex <= 0;
  galleryNext.disabled = currentIndex >= currentImages.length - 1;
}

galleryPrev.addEventListener('click', () => {
  if (currentIndex > 0) {
    currentIndex--;
    showImage(currentIndex);
    updateNavButtons();
  }
});

galleryNext.addEventListener('click', () => {
  if (currentIndex < currentImages.length - 1) {
    currentIndex++;
    showImage(currentIndex);
    updateNavButtons();
  }
});

// ── Modal close ───────────────────────────────────────────────────────────────
function closeModal() {
  modal.classList.add('hidden');
  document.body.style.overflow = '';
  currentItem = null;
}

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', closeModal);

document.addEventListener('keydown', e => {
  if (modal.classList.contains('hidden')) return;
  if (e.key === 'Escape')      closeModal();
  if (e.key === 'ArrowLeft')   galleryPrev.click();
  if (e.key === 'ArrowRight')  galleryNext.click();
});

// ── Boot ──────────────────────────────────────────────────────────────────────
const refreshBtn    = document.getElementById('refreshBtn');
const lastUpdatedEl = document.getElementById('lastUpdated');
const exportBtn     = document.getElementById('exportBtn');

let _countdownTimer = null;

function timeAgo(isoStr) {
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60)  return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60)  return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24)    return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

function formatCountdown(msLeft) {
  const totalSec = Math.max(0, Math.floor(msLeft / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0)  return `Next refresh in ${h}h ${m}m`;
  return `Next refresh in ${m}m`;
}

function applyMeta(meta) {
  clearInterval(_countdownTimer);

  if (meta.lastUpdated) {
    lastUpdatedEl.textContent = `Updated ${timeAgo(meta.lastUpdated)}`;
    exportBtn.classList.remove('disabled');
    exportBtn.title = 'Download catalogue as Excel spreadsheet';
  } else {
    lastUpdatedEl.textContent = '';
    exportBtn.classList.add('disabled');
    exportBtn.title = 'Run a Refresh first to generate the catalogue';
  }

  const nextAllowed = meta.nextAllowed ? new Date(meta.nextAllowed).getTime() : 0;
  const now = Date.now();

  if (nextAllowed > now) {
    // Locked — show countdown
    refreshBtn.disabled = true;
    const tick = () => {
      const left = nextAllowed - Date.now();
      if (left <= 0) {
        clearInterval(_countdownTimer);
        refreshBtn.disabled = false;
        refreshBtn.textContent = '↻ Refresh';
      } else {
        refreshBtn.textContent = formatCountdown(left);
      }
    };
    tick();
    _countdownTimer = setInterval(tick, 30000);
  } else {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '↻ Refresh';
  }
}

async function loadMeta() {
  try {
    const res = await fetch('/api/metadata');
    if (res.ok) applyMeta(await res.json());
  } catch { /* non-critical */ }
}

refreshBtn.addEventListener('click', async () => {
  if (refreshBtn.disabled) return;
  refreshBtn.disabled = true;
  refreshBtn.classList.add('loading');
  refreshBtn.textContent = 'Refreshing…';
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      if (data.nextAllowed) {
        applyMeta({ lastUpdated: null, nextAllowed: data.nextAllowed });
      } else {
        refreshBtn.textContent = data.error || 'Error';
        setTimeout(() => { refreshBtn.disabled = false; refreshBtn.textContent = '↻ Refresh'; }, 3000);
      }
    } else {
      // Reload items and update meta
      await loadItems();
      await loadMeta();
    }
  } catch {
    refreshBtn.textContent = 'Error — retry?';
    setTimeout(() => { refreshBtn.disabled = false; refreshBtn.textContent = '↻ Refresh'; }, 3000);
  } finally {
    refreshBtn.classList.remove('loading');
  }
});

loadItems();
loadMeta();
