// exporter.js — generates a professional XLSX catalogue from items array
// Images use Excel 365's =IMAGE() formula (no HTTP fetching — stays fast)
import ExcelJS from 'exceljs';

const SHOP_NAME    = 'Roadstar Autoparts';
const SHOP_TAGLINE = 'Quality Performance Parts & Accessories';
const SHOP_URL     = 'https://www.ebay.com.au/str/roadstarautoparts';
const SHOP_EMAIL   = 'info@roadstarautoparts.com.au';
const SHOP_PHONE   = '+61 (0) 417 000 000'; // update as needed

// ── Layout constants ───────────────────────────────────────────────────────────
const DATA_START_ROW = 8;   // rows 1-7 = header block + column headers
const DATA_ROW_H     = 82;  // pt — uniform row height (~110px, fits s-l140 thumb)
const HDR_COL_FILL   = 'FF2851C9';
const HDR_COL_FONT   = 'FFFFFFFF';
const STRIPE_FILL    = 'FFF0F4FF';
const TITLE_FILL     = 'FF1A3A7A';

// [header label, items-key, column width (chars), horizontal alignment]
const COLS = [
  { h: 'Image',     key: 'imageUrl',    w: 16, align: 'center'  },
  { h: 'Title',     key: 'title',       w: 55, align: 'left'    },
  { h: 'Price',     key: 'price',       w: 14, align: 'center'  },
  { h: 'Condition', key: 'condition',   w: 14, align: 'center'  },
  { h: 'Category',  key: 'category',    w: 18, align: 'center'  },
  { h: 'eBay Link', key: 'listingUrl',  w: 14, align: 'center'  },
];
const NCOLS = COLS.length;

function solidFill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb } };
}

function borderAll(argb = 'FFD0D8EE') {
  const s = { style: 'thin', color: { argb: argb } };
  return { top: s, left: s, bottom: s, right: s };
}

export async function generateXlsx(items, lastUpdated) {
  const wb = new ExcelJS.Workbook();
  wb.creator  = SHOP_NAME;
  wb.created  = new Date();
  wb.modified = new Date();

  const ws = wb.addWorksheet('Catalogue', {
    views:      [{ state: 'frozen', ySplit: DATA_START_ROW - 1 }],
    properties: { defaultRowHeight: DATA_ROW_H },
    pageSetup:  { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  });

  // ── Set column widths up-front ───────────────────────────────────────────
  COLS.forEach((col, i) => { ws.getColumn(i + 1).width = col.w; });

  // ── Helper: apply to a merged header row ────────────────────────────────
  function headerRow(rowNum, value, opts = {}) {
    ws.mergeCells(rowNum, 1, rowNum, NCOLS);
    const cell = ws.getCell(rowNum, 1);
    cell.value     = value;
    cell.font      = { bold: opts.bold ?? false, size: opts.size ?? 11, color: { argb: opts.fontColor ?? 'FF333333' }, name: 'Calibri' };
    cell.fill      = solidFill(opts.fill ?? 'FFFFFFFF');
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
    ws.getRow(rowNum).height = opts.height ?? 22;
    return cell;
  }

  // ── Row 1: Shop name banner ──────────────────────────────────────────────
  const r1 = headerRow(1, SHOP_NAME, { bold: true, size: 20, fontColor: 'FFFFFFFF', fill: TITLE_FILL, height: 36 });
  r1.border = { bottom: { style: 'medium', color: { argb: 'FF3665F3' } } };

  // ── Row 2: Tagline ───────────────────────────────────────────────────────
  headerRow(2, SHOP_TAGLINE, { size: 12, fontColor: 'FF444444', fill: 'FFF0F4FF', height: 22 });

  // ── Row 3: Store URL ─────────────────────────────────────────────────────
  ws.mergeCells(3, 1, 3, NCOLS);
  const r3 = ws.getCell(3, 1);
  r3.value     = { text: `🌐  ${SHOP_URL}`, hyperlink: SHOP_URL };
  r3.font      = { color: { argb: 'FF3665F3' }, underline: true, size: 10, name: 'Calibri' };
  r3.fill      = solidFill('FFFFFFFF');
  r3.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(3).height = 18;

  // ── Row 4: Contact ───────────────────────────────────────────────────────
  headerRow(4, `✉  ${SHOP_EMAIL}    📞  ${SHOP_PHONE}`, { size: 10, fontColor: 'FF555555', height: 18 });

  // ── Row 5: Generated date ─────────────────────────────────────────────────
  const printDate = (lastUpdated ? new Date(lastUpdated) : new Date())
    .toLocaleString('en-AU', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Australia/Sydney' });
  headerRow(5, `Catalogue generated: ${printDate} AEST  ·  ${items.length} items`, {
    size: 10, fontColor: 'FF888888', fill: 'FFF8F8F8', height: 18,
  });

  // ── Row 6: blank spacer ──────────────────────────────────────────────────
  ws.getRow(6).height = 6;

  // ── Row 7: Column headers ─────────────────────────────────────────────────
  COLS.forEach((col, i) => {
    const cell = ws.getCell(7, i + 1);
    cell.value     = col.h;
    cell.font      = { bold: true, color: { argb: HDR_COL_FONT }, size: 11, name: 'Calibri' };
    cell.fill      = solidFill(HDR_COL_FILL);
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border    = borderAll('FF1A3A7A');
  });
  ws.getRow(7).height = 24;

  // Autofilter anchored on header row
  ws.autoFilter = { from: { row: 7, column: 1 }, to: { row: 7, column: NCOLS } };

  // ── Data rows ─────────────────────────────────────────────────────────────
  items.forEach((item, idx) => {
    const rowIdx = DATA_START_ROW + idx;
    const row    = ws.getRow(rowIdx);
    row.height   = DATA_ROW_H;

    const stripe = idx % 2 === 1;

    // A: Image — =IMAGE() for Excel 365, IFERROR fallback hyperlink for older Excel
    const imgUrl  = (item.imageUrl || '').replace(/s-l\d+(\.\w+)?$/, 's-l140$1');
    const imgCell = ws.getCell(rowIdx, 1);
    if (imgUrl) {
      // IFERROR catches #NAME? in older Excel where IMAGE() is unknown
      imgCell.value = { formula: `IFERROR(IMAGE("${imgUrl}",2),HYPERLINK("${imgUrl}","View Image"))` };
    }
    imgCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // B: Title
    const titleCell     = ws.getCell(rowIdx, 2);
    titleCell.value     = item.title || '';
    titleCell.alignment = { vertical: 'middle', wrapText: true };

    // C: Price
    const priceCell     = ws.getCell(rowIdx, 3);
    priceCell.value     = item.price || '';
    priceCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // D: Condition
    const condCell     = ws.getCell(rowIdx, 4);
    condCell.value     = item.condition || '';
    condCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // E: Category
    const catCell     = ws.getCell(rowIdx, 5);
    catCell.value     = item.category || 'Other';
    catCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // F: eBay link
    const linkCell = ws.getCell(rowIdx, 6);
    if (item.listingUrl) {
      linkCell.value = { text: 'View on eBay', hyperlink: item.listingUrl };
      linkCell.font  = { color: { argb: 'FF3665F3' }, underline: true, size: 10 };
    }
    linkCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // Borders + zebra stripe
    for (let c = 1; c <= NCOLS; c++) {
      const cell  = ws.getCell(rowIdx, c);
      cell.border = borderAll();
      if (stripe && c !== 6) {  // don't overwrite hyperlink font
        cell.fill = solidFill(STRIPE_FILL);
      }
    }
  });

  // ── Footer row ────────────────────────────────────────────────────────────
  const footerRowIdx = DATA_START_ROW + items.length;
  ws.mergeCells(footerRowIdx, 1, footerRowIdx, NCOLS);
  const footerCell     = ws.getCell(footerRowIdx, 1);
  footerCell.value     = `Total: ${items.length} items  ·  ${SHOP_NAME}  ·  ${SHOP_URL}`;
  footerCell.font      = { italic: true, size: 9, color: { argb: 'FF888888' }, name: 'Calibri' };
  footerCell.fill      = solidFill('FFF0F4FF');
  footerCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(footerRowIdx).height = 20;

  return wb.xlsx.writeBuffer();
}
