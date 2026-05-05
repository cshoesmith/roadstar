// server.js — serves the shop frontend and fetches eBay item details via API
import express from 'express';
import { readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import { put, list } from '@vercel/blob';
import { fetchAllItems } from './scraper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT      = process.env.PORT || 3000;
const DATA_FILE = join(__dirname, 'data', 'items.json');
const IS_VERCEL = !!process.env.BLOB_READ_WRITE_TOKEN;

// Rate limit: one refresh per day
const REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// In-memory cache to avoid re-fetching Blob on every request
let _itemsCache     = null;
let _itemsCacheTime = 0;
let _lastUpdated    = null;   // ISO string
const CACHE_TTL_MS  = 5 * 60 * 1000; // 5 minutes

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function readMeta() {
  if (IS_VERCEL) {
    try {
      const { blobs } = await list({ prefix: 'roadstar/metadata.json', limit: 1 });
      if (!blobs.length) return null;
      const r = await fetch(blobs[0].url + '?t=' + Date.now());
      return r.ok ? r.json() : null;
    } catch { return null; }
  }
  // Local: use file mtime
  try {
    const { mtimeMs } = statSync(DATA_FILE);
    return { lastUpdated: new Date(mtimeMs).toISOString() };
  } catch { return null; }
}

async function readItems() {
  if (IS_VERCEL) {
    // Use in-memory cache
    if (_itemsCache && Date.now() - _itemsCacheTime < CACHE_TTL_MS) return _itemsCache;
    try {
      const { blobs } = await list({ prefix: 'roadstar/items.json', limit: 1 });
      if (blobs.length) {
        const r = await fetch(blobs[0].url + '?t=' + Date.now());
        if (r.ok) {
          _itemsCache = await r.json();
          _itemsCacheTime = Date.now();
          return _itemsCache;
        }
      }
    } catch {}
    // Fall back to bundled data/items.json from deployment
  }
  try { return JSON.parse(readFileSync(DATA_FILE, 'utf8')); } catch { return []; }
}

async function saveItems(items, lastUpdated) {
  const content = JSON.stringify(items, null, 2);
  const meta    = JSON.stringify({ lastUpdated });
  if (IS_VERCEL) {
    await Promise.all([
      put('roadstar/items.json',    content, { access: 'public', addRandomSuffix: false, contentType: 'application/json' }),
      put('roadstar/metadata.json', meta,    { access: 'public', addRandomSuffix: false, contentType: 'application/json' }),
    ]);
    // Bust cache
    _itemsCache     = items;
    _itemsCacheTime = Date.now();
  }
  // Local: scraper writes to disk itself; server doesn't write locally
  _lastUpdated = lastUpdated;
}

// ─── eBay notification endpoint verification ──────────────────────────────────
app.get('/ebay/notifications', (req, res) => {
  const challengeCode = req.query.challenge_code;
  if (!challengeCode) return res.status(400).json({ error: 'missing challenge_code' });

  const verificationToken    = process.env.EBAY_VERIFICATION_TOKEN;
  const notificationEndpoint = process.env.EBAY_NOTIFICATION_ENDPOINT;
  if (!verificationToken || !notificationEndpoint) {
    return res.status(500).json({ error: 'notification env vars not configured' });
  }

  const hash = createHash('sha256')
    .update(challengeCode + verificationToken + notificationEndpoint)
    .digest('hex');
  res.json({ challengeResponse: hash });
});

// ─── GET /api/metadata ────────────────────────────────────────────────────────
app.get('/api/metadata', async (_req, res) => {
  const meta = _lastUpdated
    ? { lastUpdated: _lastUpdated }
    : await readMeta();

  const lastUpdated  = meta?.lastUpdated ?? null;
  const nextAllowed  = lastUpdated
    ? new Date(new Date(lastUpdated).getTime() + REFRESH_COOLDOWN_MS).toISOString()
    : null;

  res.json({ lastUpdated, nextAllowed });
});

// ─── GET /api/items ───────────────────────────────────────────────────────────
app.get('/api/items', async (_req, res) => {
  try {
    res.json(await readItems());
  } catch {
    res.json([]);
  }
});

// ─── POST /api/refresh — rate-limited to once per 24 h ───────────────────────
let _refreshing = false;

app.post('/api/refresh', async (_req, res) => {
  if (_refreshing) {
    return res.status(429).json({ error: 'Refresh already in progress' });
  }

  // Check cooldown
  const meta        = _lastUpdated ? { lastUpdated: _lastUpdated } : await readMeta();
  const lastUpdated = meta?.lastUpdated;
  if (lastUpdated) {
    const elapsed = Date.now() - new Date(lastUpdated).getTime();
    if (elapsed < REFRESH_COOLDOWN_MS) {
      const nextAllowed = new Date(new Date(lastUpdated).getTime() + REFRESH_COOLDOWN_MS).toISOString();
      return res.status(429).json({ error: 'Too soon', nextAllowed });
    }
  }

  _refreshing = true;
  try {
    console.log('[shop] Starting refresh via fetchAllItems…');
    const items = await fetchAllItems();
    const now   = new Date().toISOString();
    await saveItems(items, now);
    console.log(`[shop] Refresh complete — ${items.length} items`);
    res.json({ ok: true, count: items.length, lastUpdated: now });
  } catch (err) {
    console.error('[shop] Refresh failed:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    _refreshing = false;
  }
});

const SHOPPING_API = 'https://open.api.ebay.com/shopping';

// ─── GET /api/item/:id ────────────────────────────────────────────────────────
app.get('/api/item/:id', async (req, res) => {
  const { id } = req.params;
  if (!/^\d{6,16}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid item ID' });
  }

  const APP_ID = process.env.EBAY_APP_ID;
  if (!APP_ID) return res.status(500).json({ error: 'EBAY_APP_ID not configured' });

  try {
    const params = new URLSearchParams({
      callname:         'GetSingleItem',
      responseencoding: 'JSON',
      appid:            APP_ID,
      siteid:           '15',
      ItemID:           id,
      IncludeSelector:  'Details,ItemSpecifics,ShippingCosts',
    });

    const response = await fetch(`${SHOPPING_API}?${params}`);
    if (!response.ok) return res.status(response.status).json({ error: `eBay API ${response.status}` });

    const data = await response.json();
    const item = data.GetSingleItemResponse?.Item;
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const priceVal = item.CurrentPrice?.Value;
    const price    = priceVal != null ? `AU $${parseFloat(priceVal).toFixed(2)}` : '';
    const images   = (item.PictureURL ?? []).map(u => u.replace(/s-l\d+(\.\w+)?$/, 's-l500$1')).slice(0, 12);

    const specifics = {};
    const skip = new Set(['UPC', 'MPN', 'Manufacturer Part Number']);
    for (const nvp of item.ItemSpecifics?.NameValueList ?? []) {
      if (nvp.Name && nvp.Value?.[0] && !skip.has(nvp.Name)) specifics[nvp.Name] = nvp.Value[0];
    }

    const shippingCost = item.ShippingCostSummary?.ShippingServiceCost?.Value;
    const postage = shippingCost != null
      ? (parseFloat(shippingCost) === 0 ? 'Free shipping' : `AU $${parseFloat(shippingCost).toFixed(2)}`)
      : '';

    res.json({ id, title: item.Title ?? '', price, condition: item.ConditionDisplayName ?? '', images, specifics, postage, location: item.Location ?? '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start (local dev only) ───────────────────────────────────────────────────
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => console.log(`Roadstar Shop running at http://localhost:${PORT}`));
}

export default app;

