import PDFDocument from 'pdfkit';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { PDFDocument as PdfLibDocument, StandardFonts, rgb } from 'pdf-lib';
import { generateQrPng, publicReferralUrl } from './qr-image.js';
import { createQrArtworkUrl } from './vendor-documents.js';
import { inspectArtwork } from './qr-artwork.js';

const mmToPoints = (millimetres) => millimetres * 72 / 25.4;
const DEFAULT_LABEL_SIZE = 12;

function requiredNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Print job snapshot field ${field} is invalid.`);
  return number;
}

// Geometry is resolved in exactly one place and handed to whichever engine composes the
// document, so the PDFKit and pdf-lib paths can never drift apart. All values are points in
// the template's own top-left origin; the pdf-lib composer converts to its bottom-left origin
// at the point of drawing.
function resolveGeometry(snapshot) {
  return {
    pageWidth: mmToPoints(requiredNumber(snapshot.pageWidthMm, 'pageWidthMm')),
    pageHeight: mmToPoints(requiredNumber(snapshot.pageHeightMm, 'pageHeightMm')),
    qrX: mmToPoints(requiredNumber(snapshot.qrX, 'qrX')),
    qrY: mmToPoints(requiredNumber(snapshot.qrY, 'qrY')),
    qrWidth: mmToPoints(requiredNumber(snapshot.qrWidth, 'qrWidth')),
    qrHeight: mmToPoints(requiredNumber(snapshot.qrHeight, 'qrHeight')),
    labelEnabled: Boolean(snapshot.labelEnabled),
    labelX: mmToPoints(snapshot.labelTextX || 0),
    labelY: mmToPoints(snapshot.labelTextY || 0),
    labelSize: snapshot.labelFontSize || DEFAULT_LABEL_SIZE,
  };
}

function renderPdf(document) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.end();
  });
}

async function decodePng(buffer, expectedUrl) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data || null;
  return { expectedUrl, decodedUrl: decoded, matches: decoded === expectedUrl };
}

// Downloads the stored artwork once per generation and re-inspects it with the same validator
// the upload used. An artwork that cannot be rendered raises here rather than being silently
// dropped from the printed pages.
async function loadArtwork(snapshot, jobId) {
  if (!snapshot.artworkPath) return null;
  const artworkUrl = await createQrArtworkUrl(snapshot.artworkPath);
  const artworkResponse = await fetch(artworkUrl);
  if (!artworkResponse.ok) throw new Error('Template artwork could not be downloaded for PDF generation.');
  const buffer = Buffer.from(await artworkResponse.arrayBuffer());
  try {
    const inspection = await inspectArtwork(buffer, snapshot.artworkMimeType);
    return { ...inspection, buffer };
  } catch (error) {
    error.message = `Template artwork cannot be printed${jobId ? ` for job ${jobId}` : ''}: ${error.message}`;
    throw error;
  }
}

async function qrPngFor(item, cache) {
  const cached = cache?.get(item.expectedCode);
  if (cached) return cached;
  const png = await generateQrPng(item.expectedCode);
  cache?.set(item.expectedCode, png);
  return png;
}

// PNG/JPG artwork. openImage() embeds the artwork once and every page references it; passing
// the raw Buffer to document.image() per page instead embedded a full copy on each page
// (an 8 MB artwork over 10 pages produced a 79.7 MB PDF).
// Yield to the event loop every few pages so /health and other requests keep answering while a
// large PDF is composed. This is responsiveness only; it does not lower memory use.
const yieldEvery = 10;
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

async function composeWithPdfkit(geometry, items, artwork, cache) {
  const { pageWidth, pageHeight } = geometry;
  const document = new PDFDocument({ size: [pageWidth, pageHeight], margin: 0, autoFirstPage: false });
  const artworkImage = artwork ? document.openImage(artwork.buffer) : null;

  for (const [index, item] of items.entries()) {
    if (index % yieldEvery === yieldEvery - 1) await yieldToEventLoop();
    const qrPng = await qrPngFor(item, cache);
    document.addPage({ size: [pageWidth, pageHeight], margin: 0 });
    if (artworkImage) document.image(artworkImage, 0, 0, { width: pageWidth, height: pageHeight });
    document.image(qrPng, geometry.qrX, geometry.qrY, { width: geometry.qrWidth, height: geometry.qrHeight });
    if (geometry.labelEnabled) {
      document.fontSize(geometry.labelSize).fillColor('#000000').text(item.expectedCode, geometry.labelX, geometry.labelY);
    }
  }

  return renderPdf(document);
}

// Single-page PDF artwork. PDFKit cannot embed a PDF page at all, so this path uses pdf-lib:
// embedPdf() returns one embedded page object that every output page draws, keeping the
// artwork parsed and stored once per generation rather than once per page.
async function composeWithPdfLib(geometry, items, artwork, cache) {
  const { pageWidth, pageHeight } = geometry;
  const output = await PdfLibDocument.create();
  const [artworkPage] = await output.embedPdf(artwork.buffer, [0]);
  const font = geometry.labelEnabled ? await output.embedFont(StandardFonts.Helvetica) : null;
  // PDFKit anchors text by its glyph top; pdf-lib anchors by the baseline, so the ascent is
  // added before flipping into pdf-lib's bottom-left origin to keep both paths identical.
  const labelAscent = font ? font.heightAtSize(geometry.labelSize, { descender: false }) : 0;

  for (const [index, item] of items.entries()) {
    if (index % yieldEvery === yieldEvery - 1) await yieldToEventLoop();
    const page = output.addPage([pageWidth, pageHeight]);
    page.drawPage(artworkPage, { x: 0, y: 0, width: pageWidth, height: pageHeight });
    const qrImage = await output.embedPng(await qrPngFor(item, cache));
    page.drawImage(qrImage, {
      x: geometry.qrX,
      y: pageHeight - geometry.qrY - geometry.qrHeight,
      width: geometry.qrWidth,
      height: geometry.qrHeight,
    });
    if (font) {
      page.drawText(item.expectedCode, {
        x: geometry.labelX,
        y: pageHeight - geometry.labelY - labelAscent,
        size: geometry.labelSize,
        font,
        color: rgb(0, 0, 0),
      });
    }
  }

  return Buffer.from(await output.save());
}

async function composePages(snapshot, items, jobId, cache) {
  const geometry = resolveGeometry(snapshot);
  const artwork = await loadArtwork(snapshot, jobId);
  try {
    return await (artwork?.kind === 'pdf'
      ? composeWithPdfLib(geometry, items, artwork, cache)
      : composeWithPdfkit(geometry, items, artwork, cache));
  } catch (error) {
    // Keep the real message for logs, but give the client a stable code instead of a bare 500.
    console.error('[QrPdf] generation failed:', error);
    if (!error.statusCode) {
      error.statusCode = 500;
      error.code = 'QR_PDF_GENERATION_FAILED';
      error.message = 'The PDF could not be generated. Try a smaller batch or try again.';
    }
    throw error;
  }
}

export async function generateQrProof(job) {
  const snapshot = job.templateSnapshot;
  if (!snapshot) throw new Error('Print job has no immutable template snapshot.');
  const items = job.items || [];
  // Set: first/middle/last collapse into one page when the batch has 1 or 2 items.
  const selected = [...new Set([items[0], items[Math.floor(items.length / 2)], items[items.length - 1]].filter(Boolean))];
  const verification = [];
  const cache = new Map();

  for (const item of selected) {
    const qrPng = await qrPngFor(item, cache);
    const check = await decodePng(qrPng, item.expectedUrl || publicReferralUrl(item.expectedCode));
    verification.push({ sequence: item.sequence, expectedCode: item.expectedCode, ...check });
    if (!check.matches) {
      const error = new Error(`Proof QR ${item.expectedCode} decoded to an unexpected URL.`);
      error.statusCode = 422;
      error.code = 'QR_PROOF_DECODE_MISMATCH';
      error.details = verification;
      throw error;
    }
  }

  // The proof renders through the same geometry and composer as production, artwork included,
  // so approving a proof means approving what will actually print.
  return { buffer: await composePages(snapshot, selected, job.id, cache), verification };
}

export async function generateQrTemplatePdf(job) {
  const snapshot = job.templateSnapshot;
  if (!snapshot) throw new Error('Print job has no immutable template snapshot.');
  return composePages(snapshot, job.items || [], job.id);
}
