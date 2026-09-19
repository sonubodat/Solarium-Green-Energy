// CRA's simple `"proxy"` field in package.json (the previous approach) only forwards requests
// whose Accept header does NOT include text/html — deliberately, so normal SPA page loads
// aren't hijacked. That means a fetch() call (Accept: application/json) gets proxied
// correctly, but a real top-level browser navigation (window.open, window.location.href —
// always Accept: text/html, e.g. opening a server-rendered page like the QR print sheet)
// gets served this app's own index.html instead and falls through to the client-side
// catch-all route. Configuring the proxy directly here isn't subject to that exclusion.
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function setupProxy(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      // Dev-only: API_PROXY_TARGET lets a second dev server point at a different backend
      // (e.g. a temporary test instance) without touching the one on :4000.
      target: process.env.API_PROXY_TARGET || 'http://localhost:4000',
      changeOrigin: true,
    })
  );
};
