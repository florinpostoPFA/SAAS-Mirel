const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // V0 expert route is mounted at /api/expert on the backend — remount full path.
  app.use(
    '/api/expert',
    createProxyMiddleware({
      target: 'http://localhost:3001',
      changeOrigin: true,
      pathRewrite: () => '/api/expert',
    })
  );

  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:3001',
      changeOrigin: true,
      pathRewrite: {
        '^/api': '',
      },
    })
  );
};
