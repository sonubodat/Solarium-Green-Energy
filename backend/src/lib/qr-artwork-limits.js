// Single source of truth for QR print-template artwork uploads. The multer limit, the
// service-level check and the global multer error handler all build their errors here, so
// the response is identical whichever layer rejects the file.
//
// Supported: PNG, JPG and SINGLE-PAGE PDF. PNG/JPG are composed by PDFKit; PDF artwork is
// composed by pdf-lib (PDFKit cannot embed a PDF page). Multi-page PDFs are rejected rather
// than silently printing page 1, because the editor preview shows every page.

// Hard caps on pages per print batch, from measured peak RSS (see docs/qr-template-placement.md):
// PDF artwork (pdf-lib): 300 pages ~357 MB, 400 ~458 MB, 500 ~582 MB -> over the 512 MB Render limit.
// PNG/JPG artwork (PDFKit): 500 pages ~295 MB.
export const QR_MAX_BATCH_PAGES_PDF_ARTWORK = Number(process.env.QR_MAX_BATCH_PAGES_PDF) || 300;
export const QR_MAX_BATCH_PAGES_IMAGE = Number(process.env.QR_MAX_BATCH_PAGES) || 500;

export function maxBatchPages(artworkMimeType) {
  return artworkMimeType === 'application/pdf' ? QR_MAX_BATCH_PAGES_PDF_ARTWORK : QR_MAX_BATCH_PAGES_IMAGE;
}

export function batchTooLargeError(count, limit) {
  const error = new Error(`A print batch can hold at most ${limit} QR codes for this template (this one has ${count}). Split it into smaller ranges.`);
  error.statusCode = 422;
  error.code = 'QR_BATCH_TOO_LARGE';
  return error;
}

export const QR_ARTWORK_MAX_BYTES = 8 * 1024 * 1024;
export const QR_ARTWORK_IMAGE_TYPES = new Set(['image/png', 'image/jpeg']);
export const QR_ARTWORK_PDF_TYPE = 'application/pdf';
export const QR_ARTWORK_ALLOWED_TYPES = new Set([...QR_ARTWORK_IMAGE_TYPES, QR_ARTWORK_PDF_TYPE]);

const maxMegabytes = QR_ARTWORK_MAX_BYTES / (1024 * 1024);

function artworkError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export function qrArtworkTooLargeMessage() {
  return `QR artwork must be ${maxMegabytes} MB or smaller.`;
}

export function qrArtworkTooLargeError() {
  return artworkError(qrArtworkTooLargeMessage(), 'QR_ARTWORK_TOO_LARGE', 413);
}

export function qrArtworkTypeError() {
  return artworkError('Upload a PNG, JPG, or single-page PDF artwork file.', 'INVALID_QR_ARTWORK_TYPE');
}

export function qrArtworkMultiPageError(pageCount) {
  return artworkError(
    `Multi-page PDF artwork is not supported. This file contains ${pageCount} pages. Please upload a single-page PDF.`,
    'QR_ARTWORK_MULTIPAGE_PDF',
  );
}

export function qrArtworkCorruptError(kind = 'file') {
  return artworkError(
    `This ${kind} could not be read. Re-export it and upload it again.`,
    'QR_ARTWORK_CORRUPT',
  );
}

export function qrArtworkEmptyPageError() {
  return artworkError(
    'This PDF has no drawable content on its page. Re-export the artwork with the design visible.',
    'QR_ARTWORK_EMPTY_PDF',
  );
}

export function qrArtworkEncryptedError() {
  return artworkError(
    'Password-protected PDF artwork is not supported. Remove the protection and upload it again.',
    'QR_ARTWORK_ENCRYPTED',
  );
}
