import PDFDocument from 'pdfkit';
import jsQR from 'jsqr';
import sharp from 'sharp';
import { generateQrPng, publicReferralUrl } from './qr-image.js';
import { createQrArtworkUrl } from './vendor-documents.js';

const mmToPoints = (millimetres) => millimetres * 72 / 25.4;

function requiredNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Print job snapshot field ${field} is invalid.`);
  return number;
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

export async function generateQrProof(job) {
  const snapshot = job.templateSnapshot;
  if (!snapshot) throw new Error('Print job has no immutable template snapshot.');
  const items = job.items || [];
  const selected = [items[0], items[Math.floor(items.length / 2)], items[items.length - 1]].filter(Boolean);
  const verification = [];
  const pageWidth = mmToPoints(requiredNumber(snapshot.pageWidthMm, 'pageWidthMm'));
  const pageHeight = mmToPoints(requiredNumber(snapshot.pageHeightMm, 'pageHeightMm'));
  const qrX = mmToPoints(requiredNumber(snapshot.qrX, 'qrX'));
  const qrY = mmToPoints(requiredNumber(snapshot.qrY, 'qrY'));
  const qrWidth = mmToPoints(requiredNumber(snapshot.qrWidth, 'qrWidth'));
  const qrHeight = mmToPoints(requiredNumber(snapshot.qrHeight, 'qrHeight'));
  const document = new PDFDocument({ size: [pageWidth, pageHeight], margin: 0, autoFirstPage: false });

  for (const item of selected) {
    const qrPng = await generateQrPng(item.expectedCode);
    const check = await decodePng(qrPng, item.expectedUrl || publicReferralUrl(item.expectedCode));
    verification.push({ sequence: item.sequence, expectedCode: item.expectedCode, ...check });
    if (!check.matches) {
      const error = new Error(`Proof QR ${item.expectedCode} decoded to an unexpected URL.`);
      error.statusCode = 422;
      error.code = 'QR_PROOF_DECODE_MISMATCH';
      error.details = verification;
      throw error;
    }

    document.addPage({ size: [pageWidth, pageHeight], margin: 0 });
    document.image(qrPng, qrX, qrY, {
      width: qrWidth,
      height: qrHeight,
    });
    if (snapshot.labelEnabled) {
      document.fontSize(snapshot.labelFontSize || 12).fillColor('#000000').text(item.expectedCode, mmToPoints(snapshot.labelTextX || 0), mmToPoints(snapshot.labelTextY || 0));
    }
  }

  return { buffer: await renderPdf(document), verification };
}

export async function generateQrTemplatePdf(job) {
  const snapshot = job.templateSnapshot;
  if (!snapshot) throw new Error('Print job has no immutable template snapshot.');
  const items = job.items || [];
  const pageWidth = mmToPoints(requiredNumber(snapshot.pageWidthMm, 'pageWidthMm'));
  const pageHeight = mmToPoints(requiredNumber(snapshot.pageHeightMm, 'pageHeightMm'));
  const qrX = mmToPoints(requiredNumber(snapshot.qrX, 'qrX'));
  const qrY = mmToPoints(requiredNumber(snapshot.qrY, 'qrY'));
  const qrWidth = mmToPoints(requiredNumber(snapshot.qrWidth, 'qrWidth'));
  const qrHeight = mmToPoints(requiredNumber(snapshot.qrHeight, 'qrHeight'));
  const document = new PDFDocument({ size: [pageWidth, pageHeight], margin: 0, autoFirstPage: false });
  let artwork = null;

  if (snapshot.artworkPath && snapshot.artworkMimeType?.startsWith('image/')) {
    const artworkUrl = await createQrArtworkUrl(snapshot.artworkPath);
    const artworkResponse = await fetch(artworkUrl);
    if (!artworkResponse.ok) throw new Error('Template artwork could not be downloaded for PDF generation.');
    artwork = Buffer.from(await artworkResponse.arrayBuffer());
  }

  for (const item of items) {
    const qrPng = await generateQrPng(item.expectedCode);
    document.addPage({ size: [pageWidth, pageHeight], margin: 0 });
    if (artwork) document.image(artwork, 0, 0, { width: pageWidth, height: pageHeight });
    document.image(qrPng, qrX, qrY, { width: qrWidth, height: qrHeight });
    if (snapshot.labelEnabled) {
      document.fontSize(snapshot.labelFontSize || 12).fillColor('#000000').text(item.expectedCode, mmToPoints(snapshot.labelTextX || 0), mmToPoints(snapshot.labelTextY || 0));
    }
  }

  return renderPdf(document);
}