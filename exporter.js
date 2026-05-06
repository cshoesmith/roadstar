// exporter.js — builds XLSX catalogue with directly embedded images
// No sharp required — s-l64 thumbnails are already 64px, suitable for cells
import ExcelJS from 'exceljs';

const SHOP_NAME    = 'Roadstar Autoparts';
const SHOP_TAGLINE = 'Quality Performance Parts & Accessories';
const SHOP_URL     = 'https://www.ebay.com.au/str/roadstarautoparts';
const SHOP_EMAIL   = 'info@roadstarautoparts.com.au';
const SHOP_PHONE   = '+61 (0) 417 000 000';

const DATA_START_ROW = 8;
const ROW_HEIGHT_PT  = 60;   // ~80px — comfortably fits 64px thumbnail
const CONCURRENCY    = 80;   // parallel image fetches
const DEADLINE_MS    = 50000; // 50s hard cutoff — leaves buffer for writeBuffer()

const HDR_COL_FILL = 'FF2851C9';
const HDR_COL_FONT = 'FFFFFFFF';
const STRIPE_FILL  = 'FFF0F4FF';
const TITLE_FILL   = 'FF1A3A7A';

const COLS = [
  { h: 'Image',     w: 12, align: 'center' },
  { h: 'Title',     w: 55, align: 'left'   },
  { h: 'Price',     w: 14, align: 'center' },
  { h: 'Condition', w: 14, align: 'center' },
  { h: 'Category',  w: 18, align: 'center' },
  { h: 'eBay Link', w: 14, align: 'center' },
];
const NCOLS = COLS.length;

// ── Helpers ───────────────────────────────────────────────────────────────────

function solidFill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}
function borderAll(argb = 'FFD0D8EE') {
  const s = { style: 'thin', color: { argb } };
  return { top: s, left: s, bottom: s, right: s };
}

// Fetch a single thumbnail — returns raw Buffer (JPEG) or null
async function fetchThumb(imageUrl) {
  if (!imageUrl) return null;
  const url = imageUrl.replace(/s-l\d+(\.\w+)?$/, 's-l64$1');
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

// Bounded-concurrency map — runs fn(item) for all items, max `limit` at once
async function pMap(items, fn, limit) {
  const results = new Array(items.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateXlsx(items, lastUpdated) {
  // ── Phase 1: fetch all thumbnails concurrently ────────────────────────────
  const start = Date.now();
  console.log(`[exporter] Fetching ${items.length} thumbnails (concurrency ${CONCURRENCY})…`);

  const thumbs = await pMap(items, async (item) => {
    if (Date.now() - start > DEADLINE_MS) return null;
    return fetchThumb(item.imageUrl);
  }, CONCURRENCY);

  const fetched = thumbs.filter(Boolean).length;
  console.log(`[exporter] ${fetched}/${items.length} thumbnails in ${((Date.now() - start) / 1000).toFixed(1)}s`);

  // ── Phase 2: build workbook ───────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  wb.creator = SHOP_NAME;
  wb.created = wb.modified = new Date();

  const ws = wb.addWorksheet('Catalogue', {
    views:     [{ state: 'frozen', ySplit: DATA_START_ROW - 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  });

  COLS.forEach((col, i) => { ws.getColumn(i + 1).width = col.w; });

  function hRow(rowNum, value, opts = {}) {
    ws.mergeCells(rowNum, 1, rowNum, NCOLS);
    const cell     = ws.getCell(rowNum, 1);
    cell.value     = value;
    cell.font      = { bold: opts.bold ?? false, size: opts.size ?? 11, color: { argb: opts.fontColor ?? 'FF333333' }, name: 'Calibri' };
    cell.fill      = solidFill(opts.fill ?? 'FFFFFFFF');
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(rowNum).height = opts.height ?? 22;
    return cell;
  }

  const r1 = hRow(1, SHOP_NAME, { bold: true, size: 20, fontColor: 'FFFFFFFF', fill: TITLE_FILL, height: 36 });
  r1.border = { bottom: { style: 'medium', color: { argb: 'FF3665F3' } } };
  hRow(2, SHOP_TAGLINE, { size: 12, fontColor: 'FF444444', fill: 'FFF0F4FF', height: 22 });

  ws.mergeCells(3, 1, 3, NCOLS);
  const r3 = ws.getCell(3, 1);
  r3.value     = { text: SHOP_URL, hyperlink: SHOP_URL };
  r3.font      = { color: { argb: 'FF3665F3' }, underline: true, size: 10, name: 'Calibri' };
  r3.fill      = solidFill('FFFFFFFF');
  r3.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(3).height = 18;

  hRow(4, `${SHOP_EMAIL}    ${SHOP_PHONE}`, { size: 10, fontColor: 'FF555555', height: 18 });

  const printDate = (lastUpdated ? new Date(lastUpdated) : new Date())
    .toLocaleString('en-AU', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Australia/Sydney' });
  hRow(5, `Catalogue generated: ${printDate} AEST  ·  ${items.length} items`, {
    size: 10, fontColor: 'FF888888', fill: 'FFF8F8F8', height: 18,
  });
  ws.getRow(6).height = 5;

  COLS.forEach((col, i) => {
    const cell     = ws.getCell(7, i + 1);
    cell.value     = col.h;
    cell.font      = { bold: true, color: { argb: HDR_COL_FONT }, size: 11, name: 'Calibri' };
    cell.fill      = solidFill(HDR_COL_FILL);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border    = borderAll('FF1A3A7A');
  });
  ws.getRow(7).height = 24;
  ws.autoFilter = { from: { row: 7, column: 1 }, to: { row: 7, column: NCOLS } };

  // ── Data rows ─────────────────────────────────────────────────────────────
  items.forEach((item, idx) => {
    const rowIdx = DATA_START_ROW + idx;
    ws.getRow(rowIdx).height = ROW_HEIGHT_PT;
    const stripe = idx % 2 === 1;

    // Col A: embedded thumbnail or hyperlink fallback
    const buf = thumbs[idx];
    if (buf) {
      const imgId = wb.addImage({ buffer: buf, extension: 'jpeg' });
      ws.addImage(imgId, {
        tl: { col: 0, row: rowIdx - 1 },
        br: { col: 1, row: rowIdx },
        editAs: 'oneCell',
      });
    } else if (item.imageUrl) {
      const cell  = ws.getCell(rowIdx, 1);
      cell.value  = { text: 'View Image', hyperlink: item.imageUrl };
      cell.font   = { color: { argb: 'FF3665F3' }, underline: true, size: 9 };
    }
    ws.getCell(rowIdx, 1).alignment = { horizontal: 'center', vertical: 'middle' };

    // Col B: Title
    const b = ws.getCell(rowIdx, 2);
    b.value     = item.title || '';
    b.alignment = { vertical: 'middle', wrapText: true };

    // Col C: Price
    const c = ws.getCell(rowIdx, 3);
    c.value     = item.price || '';
    c.alignment = { horizontal: 'center', vertical: 'middle' };

    // Col D: Condition
    const d = ws.getCell(rowIdx, 4);
    d.value     = item.condition || '';
    d.alignment = { horizontal: 'center', vertical: 'middle' };

    // Col E: Category
    const e = ws.getCell(rowIdx, 5);
    e.value     = item.category || 'Other';
    e.alignment = { horizontal: 'center', vertical: 'middle' };

    // Col F: eBay link
    const f = ws.getCell(rowIdx, 6);
    if (item.listingUrl) {
      f.value = { text: 'View on eBay', hyperlink: item.listingUrl };
      f.font  = { color: { argb: 'FF3665F3' }, underline: true, size: 10 };
    }
    f.alignment = { horizontal: 'center', vertical: 'middle' };

    // Borders + zebra
    for (let col = 1; col <= NCOLS; col++) {
      const cell  = ws.getCell(rowIdx, col);
      cell.border = borderAll();
      if (stripe && !(col === 6 && item.listingUrl)) {
        cell.fill = solidFill(STRIPE_FILL);
      }
    }
  });

  // ── Footer ────────────────────────────────────────────────────────────────
  const footerRow = DATA_START_ROW + items.length;
  ws.mergeCells(footerRow, 1, footerRow, NCOLS);
  const fc     = ws.getCell(footerRow, 1);
  fc.value     = `Total: ${items.length} items  ·  ${SHOP_NAME}  ·  ${SHOP_URL}`;
  fc.font      = { italic: true, size: 9, color: { argb: 'FF888888' }, name: 'Calibri' };
  fc.fill      = solidFill('FFF0F4FF');
  fc.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(footerRow).height = 18;

  console.log('[exporter] Writing workbook buffer…');
  const result = await wb.xlsx.writeBuffer();
  console.log(`[exporter] Done — ${Math.round(result.byteLength / 1024)} KB in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  return result;
}
