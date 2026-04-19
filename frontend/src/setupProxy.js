const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://192.168.0.160:3001',
      changeOrigin: true,
      pathRewrite: {
        '^/api': '',
      },
    })
  );
};
