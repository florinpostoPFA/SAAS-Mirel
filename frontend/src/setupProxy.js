const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // V0 expert route is mounted at /api/expert on the backend — keep the prefix.
  app.use(
    '/api/expert',
    createProxyMiddleware({
      target: 'http://localhost:3001',
      changeOrigin: true,
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
