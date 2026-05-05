// scraper.js — uses eBay Browse API with OAuth (modern, no rate-limit issues)
// Run with:  node --env-file=.env scraper.js
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
} from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = join(__dirname, 'data');
const OUT_FILE   = join(DATA_DIR, 'items.json');

// Env vars read lazily inside getToken() so this module can be safely imported

const OAUTH_ENDPOINT   = 'https://api.ebay.com/identity/v1/oauth2/token';
const BROWSE_API       = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const STORE_NAME       = 'roadstarautoparts';
const SELLER_USERNAME  = 'corvette299';        // eBay username (differs from store name)
const ENTRIES_PER_PAGE = 100;
const MAX_PAGES        = 100; // safety cap
const DELAY_MS         = 100; // polite delay between API calls

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── OAuth Application Token (client credentials grant) ───────────────────────
let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;

  const APP_ID  = process.env.EBAY_APP_ID;
  const CERT_ID = process.env.EBAY_CERT_ID;
  if (!APP_ID || !CERT_ID) throw new Error('EBAY_APP_ID and EBAY_CERT_ID must be set');

  const creds = Buffer.from(`${APP_ID}:${CERT_ID}`).toString('base64');
  const res = await fetch(OAUTH_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth token request failed ${res.status}: ${text}`);
  }

  const data = await res.json();
  _token = data.access_token;
  // expire 60 s early to be safe
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  console.log('  OAuth token obtained.');
  return _token;
}

function normaliseImg(src, size = '300') {
  return (src || '').replace(/s-l\d+(\.\w+)?$/, `s-l${size}$1`);
}

// ── Category mapping: eBay category name → simplified group ──────────────────
const CATEGORY_RULES = [
  { group: 'Engine',        words: ['engine', 'cylinder head', 'camshaft', 'crankshaft', 'piston', 'valve', 'gasket', 'timing', 'rocker', 'head stud', 'head bolt', 'lifter', 'pushrod', 'block'] },
  { group: 'Exhaust',       words: ['exhaust', 'header', 'manifold', 'muffler', 'resonator', 'emission', 'extractor', 'extractors', 'cat-back', 'downpipe'] },
  { group: 'Electrical',    words: ['electrical', 'ignition', 'alternator', 'starter', 'lighting', 'bulb', 'coil', 'sensor', 'switch', 'relay', 'fuse', 'wiring', 'battery', 'distributor'] },
  { group: 'Cooling',       words: ['cooling', 'radiator', 'fan', 'thermostat', 'coolant', 'water pump', 'intercooler', 'overflow'] },
  { group: 'Fuel & Air',    words: ['fuel', 'air intake', 'carburett', 'carburetor', 'filter', 'injector', 'throttle', 'supercharger', 'turbo', 'blower'] },
  { group: 'Transmission',  words: ['transmission', 'gearbox', 'clutch', 'differential', 'drivetrain', 'torque converter', 'transfer case', 'tailshaft', 'driveshaft'] },
  { group: 'Brakes',        words: ['brake', 'rotor', 'caliper', 'disc', 'drum', 'brake pad', 'handbrake'] },
  { group: 'Steering',      words: ['steering', 'suspension', 'control arm', 'ball joint', 'tie rod', 'shock', 'strut', 'spring', 'sway bar', 'cv joint', 'wheel bearing'] },
  { group: 'Wheels/Tyres',  words: ['wheel', 'tyre', 'tire', 'hub cap', 'rim', 'lug nut', 'centre cap'] },
  { group: 'Body & Trim',   words: ['body', 'exterior', 'interior', 'trim', 'panel', 'mirror', 'seat', 'window', 'bumper', 'grille', 'bonnet', 'door'] },
];

/**
 * Map an eBay category name (or item title as fallback) to a simplified group.
 * Matches on lowercased keywords; returns 'Other' if nothing matches.
 */
function mapCategory(ebayCategory, title) {
  const haystack = `${ebayCategory} ${title}`.toLowerCase();
  for (const { group, words } of CATEGORY_RULES) {
    if (words.some(w => haystack.includes(w))) return group;
  }
  return 'Other';
}

async function fetchPage(offset) {
  const token = await getToken();
  const params = new URLSearchParams({
    category_ids: '6000',   // eBay AU "Auto Parts & Accessories" top-level category
    filter:       `sellers:{${SELLER_USERNAME}}`,
    limit:        String(ENTRIES_PER_PAGE),
    offset:       String(offset),
    fieldgroups:  'MATCHING_ITEMS',
  });

  const res = await fetch(`${BROWSE_API}?${params}`, {
    headers: {
      'Authorization':          `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_AU',
      'Content-Type':            'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Browse API HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ── Exported: fetch all store items and return the array ─────────────────────
export async function fetchAllItems() {
  const scraped = [];
  let offset    = 0;
  let total     = null;

  do {
    const page = Math.floor(offset / ENTRIES_PER_PAGE) + 1;
    const approxPages = total != null ? Math.ceil(total / ENTRIES_PER_PAGE) : '?';
    console.log(`  Page ${page}/${approxPages} (offset ${offset}) …`);

    const data = await fetchPage(offset);

    if (total === null) {
      total = data.total ?? 0;
      console.log(`  Found ${total} items across ~${Math.ceil(total / ENTRIES_PER_PAGE)} pages.\n`);
    }

    const items = data.itemSummaries ?? [];
    for (const item of items) {
      const priceVal     = parseFloat(item.price?.value ?? 0);
      const title        = item.title ?? '';
      const ebayCategory = item.categories?.[0]?.categoryName ?? '';
      scraped.push({
        id:          item.itemId?.replace(/^v1\|/, '').replace(/\|.*$/, '') ?? '',
        title,
        price:       `AU $${priceVal.toFixed(2)}`,
        imageUrl:    normaliseImg(item.image?.imageUrl ?? '', '300'),
        listingUrl:  item.itemWebUrl ?? '',
        condition:   item.condition ?? 'Brand New',
        category:    mapCategory(ebayCategory, title),
        ebayCategory,
      });
    }
    console.log(`    → ${items.length} items fetched`);

    offset += items.length;
    if (items.length === 0) break;

    if (offset < total) await delay(DELAY_MS);
  } while (offset < total && Math.floor(offset / ENTRIES_PER_PAGE) < MAX_PAGES);

  return scraped;
}

// ── CLI entry point ───────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.EBAY_APP_ID || !process.env.EBAY_CERT_ID) {
    console.error('\n  ERROR: EBAY_APP_ID and EBAY_CERT_ID must both be set in .env');
    process.exit(1);
  }

  (async () => {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    let existing = [];
    if (existsSync(OUT_FILE)) {
      try { existing = JSON.parse(readFileSync(OUT_FILE, 'utf8')); } catch {}
    }

    const scraped = await fetchAllItems();
    const newIds  = new Set(scraped.map(i => i.id));
    const merged  = [...scraped, ...existing.filter(i => !newIds.has(i.id))];

    writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2));
    console.log(`\nDone. ${merged.length} total items saved to ${OUT_FILE}`);
  })().catch(err => {
    console.error('Scrape failed:', err.message);
    process.exit(1);
  });
}
