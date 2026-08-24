export function validate(schema, source = 'body') {
  return (request, _response, next) => {
    const result = schema.safeParse(request[source]);
    if (!result.success) {
      const error = new Error('Request validation failed.');
      error.statusCode = 400;
      error.code = 'VALIDATION_ERROR';
      error.details = result.error.flatten();
      return next(error);
    }
    request[source] = result.data;
    return next();
  };
}
