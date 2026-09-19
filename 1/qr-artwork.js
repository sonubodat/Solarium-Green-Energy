import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import {
  QR_ARTWORK_IMAGE_TYPES,
  QR_ARTWORK_PDF_TYPE,
  qrArtworkCorruptError,
  qrArtworkEmptyPageError,
  qrArtworkEncryptedError,
  qrArtworkMultiPageError,
  qrArtworkTypeError,
} from '../lib/qr-artwork-limits.js';

const POINTS_PER_MM = 72 / 25.4;

// The multipart Content-Type is supplied by the browser and is not trustworthy on its own —
// before this existed, a random binary declared as image/png was accepted and stored. Every
// artwork file is inspected by the same library that will later have to render it, so a
// successful upload genuinely implies the file can be printed.
export async function inspectArtwork(buffer, mimetype) {
  if (!buffer?.length) throw qrArtworkTypeError();

  if (QR_ARTWORK_IMAGE_TYPES.has(mimetype)) {
    let metadata;
    try {
      metadata = await sharp(buffer).metadata();
    } catch (error) {
      throw qrArtworkCorruptError('image');
    }
    if (!['png', 'jpeg'].includes(metadata.format)) throw qrArtworkTypeError();
    // Images carry no physical size, so there is nothing to compare against the template page.
    return { kind: 'image', pageCount: 1, widthMm: null, heightMm: null };
  }

  if (mimetype === QR_ARTWORK_PDF_TYPE) {
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw qrArtworkCorruptError('PDF');
    let document;
    try {
      // No ignoreEncryption: an encrypted PDF must surface as its own error rather than
      // loading into something pdf-lib cannot reliably draw.
      document = await PDFDocument.load(buffer);
    } catch (error) {
      if (/encrypt/i.test(error?.message || '')) throw qrArtworkEncryptedError();
      throw qrArtworkCorruptError('PDF');
    }
    const pageCount = document.getPageCount();
    if (pageCount !== 1) throw qrArtworkMultiPageError(pageCount);
    const page = document.getPage(0);
    // pdf-lib cannot embed a page that has no content stream ("Can't embed page with missing
    // Contents"), which a genuinely blank exported page has. Reject it here so it can never
    // reach generation and fail a print run.
    if (!page.node.Contents()) throw qrArtworkEmptyPageError();
    const { width, height } = page.getSize();
    return {
      kind: 'pdf',
      pageCount,
      widthMm: Math.round((width / POINTS_PER_MM) * 10) / 10,
      heightMm: Math.round((height / POINTS_PER_MM) * 10) / 10,
    };
  }

  throw qrArtworkTypeError();
}

// Artwork is always stretched to fill the template page (the rule PNG/JPG has always used),
// so a size mismatch distorts the design. Warn rather than block: the admin may have
// deliberately exported at a different trim size.
export function artworkSizeWarning(inspection, pageWidthMm, pageHeightMm) {
  if (!inspection || inspection.kind !== 'pdf' || !inspection.widthMm) return null;
  const offBy = (a, b) => Math.abs(a - b) > Math.max(1, b * 0.01);
  if (!offBy(inspection.widthMm, pageWidthMm) && !offBy(inspection.heightMm, pageHeightMm)) return null;
  return `Artwork is ${inspection.widthMm}x${inspection.heightMm} mm but the template page is ${pageWidthMm}x${pageHeightMm} mm. It will be stretched to fit.`;
}
