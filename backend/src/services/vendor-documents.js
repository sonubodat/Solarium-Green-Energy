import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { env } from '../config/env.js';
import { QR_ARTWORK_ALLOWED_TYPES, QR_ARTWORK_MAX_BYTES, qrArtworkTooLargeError, qrArtworkTypeError } from '../lib/qr-artwork-limits.js';
import { inspectArtwork } from './qr-artwork.js';

const maxFileSize = 200 * 1024;
const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);

// Raw-upload ceiling only — an abuse/sanity limit, not the stored size. A modern phone photo
// is routinely 3-6MB; compressVendorPhoto() shrinks whatever comes in down to ~800KB-1MB
// before it ever reaches Storage, so this just bounds how much memory/bandwidth one upload
// can use.
const maxPhotoUploadSize = 15 * 1024 * 1024;
const allowedPhotoTypes = new Set(['image/jpeg', 'image/png']);
const targetPhotoBytes = 900 * 1024;

function storageClient() {
  let validUrl = false;
  try {
    const url = new URL(env.supabaseUrl);
    validUrl = url.protocol === 'https:' && url.hostname.endsWith('.supabase.co') && url.pathname === '/';
  } catch (error) {
    validUrl = false;
  }
  const looksLikeApiKey = env.supabaseServiceRoleKey.startsWith('eyJ');
  if (!validUrl || !looksLikeApiKey) {
    const error = new Error('Vendor document storage is not configured.');
    error.statusCode = 503;
    error.code = 'DOCUMENT_STORAGE_UNAVAILABLE';
    throw error;
  }
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false } });
}

export function validateDocument(file) {
  if (!file || !allowedTypes.has(file.mimetype)) {
    const error = new Error('Upload a PDF, JPG, or PNG document.');
    error.statusCode = 400;
    error.code = 'INVALID_DOCUMENT_TYPE';
    throw error;
  }
  if (file.size > maxFileSize) {
    const error = new Error('Documents must be 200 KB or smaller.');
    error.statusCode = 413;
    error.code = 'DOCUMENT_TOO_LARGE';
    throw error;
  }
}

export async function uploadVendorDocument(vendorId, type, file) {
  validateDocument(file);
  const objectKey = `${vendorId}/${type}-${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error } = await storageClient().storage.from(env.supabaseStorageBucket).upload(objectKey, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) {
    error.statusCode = 502;
    error.code = 'DOCUMENT_UPLOAD_FAILED';
    throw error;
  }
  return { objectKey, fileName: file.originalname, fileSize: file.size, contentType: file.mimetype };
}

export async function removeVendorDocument(objectKey) {
  if (!objectKey || !env.supabaseUrl || !env.supabaseServiceRoleKey) return;
  await storageClient().storage.from(env.supabaseStorageBucket).remove([objectKey]);
}

export async function createVendorDocumentUrl(objectKey) {
  if (!objectKey) return null;
  const { data, error } = await storageClient().storage.from(env.supabaseStorageBucket).createSignedUrl(objectKey, 300);
  if (error) {
    error.statusCode = 502;
    error.code = 'DOCUMENT_URL_FAILED';
    throw error;
  }
  return data.signedUrl;
}

export async function uploadQrArtwork(adminId, file) {
  if (!file || !QR_ARTWORK_ALLOWED_TYPES.has(file.mimetype)) throw qrArtworkTypeError();
  if (file.size > QR_ARTWORK_MAX_BYTES) throw qrArtworkTooLargeError();
  // Inspect before uploading, so a file that cannot be printed never reaches Storage and
  // never creates a template row. Throws a specific error per failure reason.
  const inspection = await inspectArtwork(file.buffer, file.mimetype);
  const objectKey = `templates/${adminId}/${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error } = await storageClient().storage.from(env.supabaseQrStorageBucket).upload(objectKey, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) {
    error.statusCode = 502;
    error.code = 'QR_ARTWORK_UPLOAD_FAILED';
    throw error;
  }
  return { objectKey, fileName: file.originalname, fileSize: file.size, contentType: file.mimetype, inspection };
}

export async function removeQrArtwork(objectKey) {
  if (!objectKey) return;
  const { error } = await storageClient().storage.from(env.supabaseQrStorageBucket).remove([objectKey]);
  if (error) {
    error.statusCode = 502;
    error.code = 'QR_ARTWORK_DELETE_FAILED';
    throw error;
  }
}

export async function createQrArtworkUrl(objectKey) {
  if (!objectKey) return null;
  const { data, error } = await storageClient().storage.from(env.supabaseQrStorageBucket).createSignedUrl(objectKey, 300);
  if (error) {
    error.statusCode = 502;
    error.code = 'QR_ARTWORK_URL_FAILED';
    throw error;
  }
  return data.signedUrl;
}

export function validateVendorPhoto(file) {
  if (!file || !allowedPhotoTypes.has(file.mimetype)) {
    const error = new Error('Upload a JPG or PNG photo.');
    error.statusCode = 400;
    error.code = 'INVALID_PHOTO_TYPE';
    throw error;
  }
  if (file.size > maxPhotoUploadSize) {
    const error = new Error('Photos must be 15 MB or smaller.');
    error.statusCode = 413;
    error.code = 'PHOTO_TOO_LARGE';
    throw error;
  }
}

// Storage-cost containment for Supabase's free 5GB tier: ~800KB-1MB x 2 photos/vendor still
// keeps thousands of Solar Mitras' onboarding media well within it, while staying legible —
// versus a few hundred if raw 3-6MB phone photos were kept. Quality steps down first (cheaper, keeps resolution);
// dimensions only shrink further if a very detailed image still can't hit the target at the
// quality floor. .rotate() with no argument applies the photo's own EXIF orientation before
// re-encoding strips EXIF — otherwise a portrait phone photo can come out sideways. Always
// re-encodes to JPEG regardless of input type; a photo never benefits from PNG's lossless mode.
async function compressVendorPhoto(buffer) {
  let width = 1920;
  let quality = 88;
  let output = await sharp(buffer).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality }).toBuffer();
  while (output.length > targetPhotoBytes && quality > 50) {
    quality -= 8;
    output = await sharp(buffer).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality }).toBuffer();
  }
  while (output.length > targetPhotoBytes && width > 800) {
    width -= 240;
    output = await sharp(buffer).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality }).toBuffer();
  }
  return output;
}

export async function uploadVendorPhoto(vendorId, type, file) {
  validateVendorPhoto(file);
  const compressed = await compressVendorPhoto(file.buffer);
  const objectKey = `${vendorId}/${type}-${Date.now()}.jpg`;
  const { error } = await storageClient().storage.from(env.supabaseVendorPhotosBucket).upload(objectKey, compressed, { contentType: 'image/jpeg', upsert: false });
  if (error) {
    error.statusCode = 502;
    error.code = 'PHOTO_UPLOAD_FAILED';
    throw error;
  }
  return { objectKey, fileName: file.originalname, fileSize: compressed.length, contentType: 'image/jpeg' };
}

export async function removeVendorPhoto(objectKey) {
  if (!objectKey || !env.supabaseUrl || !env.supabaseServiceRoleKey) return;
  await storageClient().storage.from(env.supabaseVendorPhotosBucket).remove([objectKey]);
}

export async function createVendorPhotoUrl(objectKey) {
  if (!objectKey) return null;
  const { data, error } = await storageClient().storage.from(env.supabaseVendorPhotosBucket).createSignedUrl(objectKey, 300);
  if (error) {
    error.statusCode = 502;
    error.code = 'PHOTO_URL_FAILED';
    throw error;
  }
  return data.signedUrl;
}

export async function uploadQrProof(jobId, buffer) {
  const objectKey = `proofs/${jobId}-${Date.now()}.pdf`;
  const { error } = await storageClient().storage.from(env.supabaseQrStorageBucket).upload(objectKey, buffer, { contentType: 'application/pdf', upsert: false });
  if (error) {
    error.statusCode = 502;
    error.code = 'QR_PROOF_UPLOAD_FAILED';
    throw error;
  }
  return { objectKey, fileName: `${jobId}-proof.pdf` };
}