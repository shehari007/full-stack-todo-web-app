/**
 * Branded A4 report builder.
 *
 * One generic entry point, `renderReportPdf`, draws a letterhead, a summary
 * band and a paginated table, and hands back a finished `Buffer`.
 *
 * It returns a Buffer rather than a stream on purpose. Piping a PDFKit document
 * straight to the response commits the status line and headers before the first
 * table row is laid out, so a failure halfway through (a corrupt logo, a font
 * error) arrives at the client as a truncated file that its PDF reader blames
 * on the download. Buffering costs a few hundred kilobytes and lets a failure
 * surface as a normal JSON error instead.
 */
import PDFDocument from 'pdfkit';

/**
 * PDFKit ships decoders for PNG and JPEG and nothing else. A WebP, SVG, GIF or
 * ICO logo (all of which the upload allowlist permits) throws inside
 * `doc.image()`, so those are detected here and fall back to the wordmark.
 */
const EMBEDDABLE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);

const PAGE_MARGINS = { top: 56, bottom: 56, left: 48, right: 48 } as const;

const LOGO_MAX_HEIGHT = 36;
const LOGO_MAX_WIDTH = 170;

const TABLE_HEADER_HEIGHT = 22;
const TABLE_ROW_HEIGHT = 20;
const CELL_PADDING = 6;

/* Neutral palette. Brand colours are supplied per document and only ever used
 * for accents, so a garish custom primary cannot make body text unreadable. */
const INK = '#111827';
const MUTED = '#6b7280';
const HAIRLINE = '#e5e7eb';
const ZEBRA = '#f7f8fa';

export interface PdfLogo {
  data: Buffer;
  mimeType: string;
}

export interface PdfOrganisation {
  name: string;
  legalName: string;
  email: string;
  phone: string;
  addressLine: string;
  website: string;
}

/** A coloured chip drawn in place of the cell's text. */
export interface PdfPill {
  label: string;
  color: string;
}

export interface PdfColumn<Row> {
  header: string;
  /**
   * Relative weight, not points. Weights are normalised against the content
   * width, so columns always add up to exactly the printable area no matter
   * what page size or margins the document ends up with.
   */
  weight: number;
  value: (row: Row) => string;
  align?: 'left' | 'right';
  pill?: (row: Row) => PdfPill;
}

export interface PdfStat {
  label: string;
  value: string;
}

export interface PdfReportSpec<Row> {
  title: string;
  subtitle: string;
  /** Plain-language description of the filters that produced these rows. */
  filterSummary: string;
  /** Already formatted in the reader's timezone by the caller. */
  generatedAt: string;
  ownerName: string;
  siteName: string;
  logoText: string;
  logo: PdfLogo | null;
  organisation: PdfOrganisation;
  creditLine: string;
  primaryColor: string;
  accentColor: string;
  stats: PdfStat[];
  columns: PdfColumn<Row>[];
  rows: Row[];
  emptyMessage: string;
}

export async function renderReportPdf<Row>(spec: PdfReportSpec<Row>): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { ...PAGE_MARGINS },
    /* Required for "Page N of M": the total is not known until the last row is
     * placed, so pages are held in memory and footers stamped afterwards. */
    bufferPages: true,
    info: {
      Title: spec.title,
      Author: spec.ownerName,
      Creator: spec.siteName,
      Producer: spec.siteName,
      CreationDate: new Date(),
    },
  });

  // Attached before any drawing so a synchronous failure below still rejects
  // through the promise rather than escaping as an unhandled 'error' event.
  const finished = collect(doc);

  const width = contentWidth(doc);

  drawLetterhead(doc, spec, width);
  drawTitleBlock(doc, spec, width);
  drawSummaryBand(doc, spec, width);
  drawTable(doc, spec, width);
  stampFooters(doc, spec);

  doc.end();
  return finished;
}

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                           */
/* -------------------------------------------------------------------------- */

function contentWidth(doc: PDFKit.PDFDocument): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function contentBottom(doc: PDFKit.PDFDocument): number {
  return doc.page.height - doc.page.margins.bottom;
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

/**
 * Shorten `text` until it fits `width`, appending an ellipsis.
 *
 * PDFKit has an `ellipsis` option, but it is applied by the line wrapper, which
 * never runs when `lineBreak: false`, and that is exactly the mode table cells
 * need. Left to itself the text would simply overflow into the next column, so
 * the width is measured here instead. Must be called with the cell's font
 * already active.
 */
function truncate(doc: PDFKit.PDFDocument, text: string, width: number): string {
  if (width <= 0) return '';
  if (doc.widthOfString(text) <= width) return text;

  let candidate = text;
  while (candidate.length > 0 && doc.widthOfString(`${candidate}...`) > width) {
    candidate = candidate.slice(0, -1);
  }
  return `${candidate.trimEnd()}...`;
}

/**
 * Pick black or white body text for a coloured chip.
 *
 * Brand colours are administrator-supplied, so a fixed white label would vanish
 * on a pale primary. Rec. 709 luma is close enough to perceived brightness for
 * a two-way choice.
 */
function readableTextColor(hex: string): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return '#ffffff';

  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return '#ffffff';

  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? INK : '#ffffff';
}

/* -------------------------------------------------------------------------- */
/* Letterhead                                                                 */
/* -------------------------------------------------------------------------- */

function drawLetterhead<Row>(
  doc: PDFKit.PDFDocument,
  spec: PdfReportSpec<Row>,
  width: number,
): void {
  const left = doc.page.margins.left;
  const top = doc.y;
  let markBottom = top;

  let drewImage = false;

  if (spec.logo && EMBEDDABLE_IMAGE_TYPES.has(spec.logo.mimeType)) {
    try {
      // `fit` scales inside the box while preserving the aspect ratio, so a wide
      // or tall logo is never distorted.
      doc.image(spec.logo.data, left, top, { fit: [LOGO_MAX_WIDTH, LOGO_MAX_HEIGHT] });
      markBottom = top + LOGO_MAX_HEIGHT;
      drewImage = true;
    } catch {
      // A truncated or mislabelled file must not cost the user their export.
      drewImage = false;
    }
  }

  if (!drewImage) {
    doc.font('Helvetica-Bold').fontSize(20).fillColor(spec.primaryColor);
    doc.text(spec.logoText || spec.siteName, left, top, { width: width * 0.5, lineBreak: false });
    markBottom = top + 24;
  }

  /* Organisation block, right-aligned against the wordmark. */
  const org = spec.organisation;
  const lines = [
    org.legalName || org.name,
    org.addressLine,
    org.phone,
    org.email,
    org.website,
  ].filter((line) => line.length > 0);

  if (lines.length > 0) {
    const blockWidth = width * 0.45;
    const blockLeft = doc.page.margins.left + width - blockWidth;
    let y = top;

    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK);
    doc.text(lines[0] ?? '', blockLeft, y, { width: blockWidth, align: 'right', lineBreak: false });
    y += 11;

    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    for (const line of lines.slice(1)) {
      doc.text(line, blockLeft, y, { width: blockWidth, align: 'right', lineBreak: false });
      y += 10;
    }

    markBottom = Math.max(markBottom, y);
  }

  const ruleY = markBottom + 10;
  doc.moveTo(left, ruleY).lineTo(left + width, ruleY);
  doc.lineWidth(1.5).strokeColor(spec.primaryColor).stroke();

  // A short accent segment laid over the rule puts the installation's second
  // brand colour on the page without tinting anything a reader has to read.
  doc.moveTo(left, ruleY).lineTo(left + Math.min(72, width), ruleY);
  doc.lineWidth(1.5).strokeColor(spec.accentColor).stroke();

  doc.x = doc.page.margins.left;
  doc.y = ruleY + 18;
}

/* -------------------------------------------------------------------------- */
/* Title and filters                                                          */
/* -------------------------------------------------------------------------- */

function drawTitleBlock<Row>(
  doc: PDFKit.PDFDocument,
  spec: PdfReportSpec<Row>,
  width: number,
): void {
  const left = doc.page.margins.left;

  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK);
  doc.text(spec.title, left, doc.y, { width });

  if (spec.subtitle) {
    doc.moveDown(0.15);
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED);
    doc.text(spec.subtitle, left, doc.y, { width });
  }

  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(spec.primaryColor);
  doc.text(spec.filterSummary, left, doc.y, { width });

  doc.moveDown(0.25);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED);
  doc.text(`Prepared for ${spec.ownerName} · Generated ${spec.generatedAt}`, left, doc.y, {
    width,
  });

  doc.y += 14;
}

/* -------------------------------------------------------------------------- */
/* Summary band                                                               */
/* -------------------------------------------------------------------------- */

function drawSummaryBand<Row>(
  doc: PDFKit.PDFDocument,
  spec: PdfReportSpec<Row>,
  width: number,
): void {
  if (spec.stats.length === 0) return;

  const left = doc.page.margins.left;
  const top = doc.y;
  const height = 50;
  const cellWidth = width / spec.stats.length;

  doc.roundedRect(left, top, width, height, 6).fillAndStroke('#fbfbfd', HAIRLINE);

  spec.stats.forEach((stat, index) => {
    const x = left + index * cellWidth;

    if (index > 0) {
      doc.moveTo(x, top + 10).lineTo(x, top + height - 10);
      doc.lineWidth(0.5).strokeColor(HAIRLINE).stroke();
    }

    doc.font('Helvetica-Bold').fontSize(15).fillColor(spec.primaryColor);
    doc.text(stat.value, x, top + 11, { width: cellWidth, align: 'center', lineBreak: false });

    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
    doc.text(stat.label.toUpperCase(), x, top + 31, {
      width: cellWidth,
      align: 'center',
      lineBreak: false,
      characterSpacing: 0.6,
    });
  });

  doc.x = left;
  doc.y = top + height + 20;
}

/* -------------------------------------------------------------------------- */
/* Table                                                                      */
/* -------------------------------------------------------------------------- */

function drawTable<Row>(doc: PDFKit.PDFDocument, spec: PdfReportSpec<Row>, width: number): void {
  const left = doc.page.margins.left;

  if (spec.rows.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(10).fillColor(MUTED);
    doc.text(spec.emptyMessage, left, doc.y, { width, align: 'center' });
    return;
  }

  const totalWeight = spec.columns.reduce((sum, column) => sum + column.weight, 0) || 1;
  const widths = spec.columns.map((column) => (column.weight / totalWeight) * width);

  const offsets: number[] = [];
  let cursor = left;
  for (const columnWidth of widths) {
    offsets.push(cursor);
    cursor += columnWidth;
  }

  let y = drawTableHeader(doc, spec, left, doc.y, widths, offsets);

  spec.rows.forEach((row, index) => {
    if (y + TABLE_ROW_HEIGHT > contentBottom(doc)) {
      doc.addPage();
      y = drawTableHeader(doc, spec, left, doc.page.margins.top, widths, offsets);
    }

    // Striping is keyed off the row's index in the data, not its index on the
    // page, so the banding stays continuous across a page break.
    if (index % 2 === 1) {
      doc.rect(left, y, width, TABLE_ROW_HEIGHT).fill(ZEBRA);
    }

    spec.columns.forEach((column, columnIndex) => {
      const columnWidth = widths[columnIndex] ?? 0;
      const x = offsets[columnIndex] ?? left;
      const pill = column.pill?.(row);

      if (pill) {
        drawPill(doc, pill, x + CELL_PADDING, y + 4, columnWidth - CELL_PADDING * 2);
        return;
      }

      doc.font('Helvetica').fontSize(8.5).fillColor(INK);
      const inner = columnWidth - CELL_PADDING * 2;
      doc.text(truncate(doc, column.value(row), inner), x + CELL_PADDING, y + 6, {
        width: inner,
        align: column.align ?? 'left',
        lineBreak: false,
      });
    });

    y += TABLE_ROW_HEIGHT;
  });

  doc.moveTo(left, y).lineTo(left + width, y);
  doc.lineWidth(0.5).strokeColor(HAIRLINE).stroke();

  doc.x = left;
  doc.y = y + 12;
}

/** Draws the header band and returns the y at which body rows start. */
function drawTableHeader<Row>(
  doc: PDFKit.PDFDocument,
  spec: PdfReportSpec<Row>,
  left: number,
  top: number,
  widths: number[],
  offsets: number[],
): number {
  const width = widths.reduce((sum, value) => sum + value, 0);

  doc.rect(left, top, width, TABLE_HEADER_HEIGHT).fill(spec.primaryColor);

  const headerInk = readableTextColor(spec.primaryColor);

  spec.columns.forEach((column, index) => {
    const columnWidth = widths[index] ?? 0;
    const x = offsets[index] ?? left;
    const inner = columnWidth - CELL_PADDING * 2;

    doc.font('Helvetica-Bold').fontSize(8).fillColor(headerInk);
    doc.text(truncate(doc, column.header.toUpperCase(), inner), x + CELL_PADDING, top + 7, {
      width: inner,
      align: column.align ?? 'left',
      lineBreak: false,
      characterSpacing: 0.4,
    });
  });

  return top + TABLE_HEADER_HEIGHT;
}

function drawPill(
  doc: PDFKit.PDFDocument,
  pill: PdfPill,
  x: number,
  y: number,
  maxWidth: number,
): void {
  doc.font('Helvetica-Bold').fontSize(7);

  const label = truncate(doc, pill.label, maxWidth - 12);
  const pillWidth = Math.min(doc.widthOfString(label) + 12, maxWidth);
  const height = TABLE_ROW_HEIGHT - 8;

  doc.roundedRect(x, y, pillWidth, height, height / 2).fill(pill.color);

  doc.fillColor(readableTextColor(pill.color));
  doc.text(label, x, y + 3.2, { width: pillWidth, align: 'center', lineBreak: false });
}

/* -------------------------------------------------------------------------- */
/* Footers                                                                    */
/* -------------------------------------------------------------------------- */

function stampFooters<Row>(doc: PDFKit.PDFDocument, spec: PdfReportSpec<Row>): void {
  const range = doc.bufferedPageRange();

  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);

    /*
     * The footer sits inside the bottom margin. PDFKit adds a fresh page the
     * moment text crosses that boundary, and each new page would then need a
     * footer of its own, an unbounded loop. Zeroing the margin for the length
     * of the stamp is the documented way out.
     */
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const left = doc.page.margins.left;
    const width = contentWidth(doc);
    const baseline = doc.page.height - bottomMargin + 16;

    doc.moveTo(left, baseline - 8).lineTo(left + width, baseline - 8);
    doc.lineWidth(0.5).strokeColor(HAIRLINE).stroke();

    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);

    const credit = [spec.siteName, spec.creditLine].filter(Boolean).join(' · ');
    doc.text(truncate(doc, credit, width * 0.7), left, baseline, {
      width: width * 0.7,
      lineBreak: false,
    });

    doc.text(`Page ${index + 1} of ${range.count}`, left + width * 0.7, baseline, {
      width: width * 0.3,
      align: 'right',
      lineBreak: false,
    });

    doc.page.margins.bottom = bottomMargin;
  }
}
