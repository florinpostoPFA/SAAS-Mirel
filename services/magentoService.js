async function getOrder(orderId) {
  return {
    id: orderId,
    status: "processing",
    items: [
      { name: "Interior Cleaner", qty: 1 }
    ],
    total: 120,
    currency: "RON"
  };
}

async function getCustomerOrders(customerId) {
  return [
    {
      id: "ORD-001",
      customerId,
      status: "delivered",
      items: [
        { name: "Exterior Wax", qty: 2 }
      ],
      total: 240,
      currency: "RON"
    },
    {
      id: "ORD-002",
      customerId,
      status: "processing",
      items: [
        { name: "Interior Cleaner", qty: 1 }
      ],
      total: 120,
      currency: "RON"
    }
  ];
}

async function getProductStock(sku) {
  return {
    sku,
    qty: 42,
    inStock: true
  };
}

async function updateOrder(orderId, data) {
  return {
    id: orderId,
    ...data,
    updated: true
  };
}

module.exports = {
  getOrder,
  getCustomerOrders,
  getProductStock,
  updateOrder
};
