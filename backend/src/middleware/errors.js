export function notFoundHandler(_request, response) {
  response.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Resource was not found.' },
  });
}

export function errorHandler(error, _request, response, _next) {
  if ((error.statusCode || 500) >= 500) {
    console.error(error);
  }
  response.status(error.statusCode || 500).json({
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.statusCode ? error.message : 'An unexpected error occurred.',
      ...(error.details ? { details: error.details } : {}),
    },
  });
}
