export function requireAuth(_request, _response, next) {
  next(new Error('Authentication middleware is not implemented yet.'));
}

export function requireAdmin(_request, _response, next) {
  next(new Error('Admin authorization middleware is not implemented yet.'));
}

export function requireSales(_request, _response, next) {
  next(new Error('Sales authorization middleware is not implemented yet.'));
}

export function requireVendor(_request, _response, next) {
  next(new Error('Vendor authorization middleware is not implemented yet.'));
}
