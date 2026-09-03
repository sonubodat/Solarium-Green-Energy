import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

const maxFileSize = 200 * 1024;
const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);

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
  if (!file || !allowedTypes.has(file.mimetype)) {
    const error = new Error('Upload a PDF, JPG, or PNG artwork file.');
    error.statusCode = 400;
    error.code = 'INVALID_QR_ARTWORK_TYPE';
    throw error;
  }
  if (file.size > 2 * 1024 * 1024) {
    const error = new Error('QR artwork must be 2 MB or smaller.');
    error.statusCode = 413;
    error.code = 'QR_ARTWORK_TOO_LARGE';
    throw error;
  }
  const objectKey = `templates/${adminId}/${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const { error } = await storageClient().storage.from(env.supabaseQrStorageBucket).upload(objectKey, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) {
    error.statusCode = 502;
    error.code = 'QR_ARTWORK_UPLOAD_FAILED';
    throw error;
  }
  return { objectKey, fileName: file.originalname, fileSize: file.size, contentType: file.mimetype };
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