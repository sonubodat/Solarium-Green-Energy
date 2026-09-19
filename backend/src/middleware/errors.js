import { qrArtworkTooLargeMessage } from '../lib/qr-artwork-limits.js';

export function notFoundHandler(_request, response) {
  response.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Resource was not found.' },
  });
}

export function errorHandler(error, request, response, _next) {
  if (error.name === 'MulterError' && error.code === 'LIMIT_FILE_SIZE') {
    // Multer's own size-limit error is thrown by its middleware before the route handler
    // ever runs, so it always lands here (Express skips straight to error-handling
    // middleware) — a route's own inline MulterError check in its catch block never fires.
    // The multipart field name is the only way to tell which upload this was.
    if (error.field === 'artwork') {
      return response.status(413).json({ success: false, error: { code: 'QR_ARTWORK_TOO_LARGE', message: qrArtworkTooLargeMessage() } });
    }
    if (error.field === 'photo') {
      return response.status(413).json({ success: false, error: { code: 'PHOTO_TOO_LARGE', message: 'Photos must be 15 MB or smaller.' } });
    }
    return response.status(413).json({ success: false, error: { code: 'DOCUMENT_TOO_LARGE', message: 'Documents must be 200 KB or smaller.' } });
  }
  if (error.name === 'ZodError') {
    return response.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    });
  }
  const statusCode = error.statusCode || 500;
  console.error('[Solarium API error]', JSON.stringify({
    method: request.method,
    path: request.originalUrl,
    status: statusCode,
    name: error.name,
    code: error.code || 'INTERNAL_ERROR',
    message: error.message,
    details: error.details || error.issues || undefined,
    stack: statusCode >= 500 ? error.stack : undefined,
  }, null, 2));
  response.status(error.statusCode || 500).json({
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.statusCode ? error.message : 'An unexpected error occurred.',
      ...(error.details ? { details: error.details } : {}),
    },
  });
}
