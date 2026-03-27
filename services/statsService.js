// Stats tracking and aggregation
let stats = {
  conversations: 0,
  keywords: {},
  products: {}
};

function incrementConversation() {
  stats.conversations++;
}

function trackKeywords(message) {
  const words = message.toLowerCase().split(" ");
  words.forEach(w => {
    if (!stats.keywords[w]) stats.keywords[w] = 0;
    stats.keywords[w]++;
  });
}

function trackProducts(products) {
  products.forEach(p => {
    if (!stats.products[p.name]) stats.products[p.name] = 0;
    stats.products[p.name]++;
  });
}

function getStats(clicks, conversions, timeline) {
  return {
    conversations: stats.conversations,
    keywords: stats.keywords,
    products: stats.products,
    clicks: clicks.length,
    conversions: conversions.length,
    revenue: calculateRevenue(conversions),
    timeline
  };
}

function calculateRevenue(conversions) {
  return conversions.reduce((sum, c) => sum + c.value, 0);
}

module.exports = {
  incrementConversation,
  trackKeywords,
  trackProducts,
  getStats,
  calculateRevenue
};
