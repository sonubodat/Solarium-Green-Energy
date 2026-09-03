export function notFoundHandler(_request, response) {
  response.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Resource was not found.' },
  });
}

export function errorHandler(error, _request, response, _next) {
  if (error.name === 'MulterError' && error.code === 'LIMIT_FILE_SIZE') {
    const isQrArtwork = error.field === 'artwork';
    return response.status(413).json({
      success: false,
      error: {
        code: isQrArtwork ? 'QR_ARTWORK_TOO_LARGE' : 'DOCUMENT_TOO_LARGE',
        message: isQrArtwork ? 'QR artwork must be 2 MB or smaller.' : 'Documents must be 200 KB or smaller.',
      },
    });
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
