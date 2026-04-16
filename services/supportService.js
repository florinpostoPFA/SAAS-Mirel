const magentoService = require("./magentoService");

async function handle(intent, message, session) {
  if (intent === "order_status") {
    const match = message.match(/#?(\d+)/);
    if (!match) {
      return { message: "Te pot ajuta cu statusul comenzii. Te rog să îmi spui numărul comenzii." };
    }
    const orderId = match[1];
    const order = await magentoService.getOrder(orderId);
    return {
      message: `Comanda #${order.id} este în status: ${order.status} și conține ${order.items.length} produs${order.items.length !== 1 ? "e" : ""}.`
    };
  }

  if (intent === "order_update") {
    return { message: "Ce modificare dorești să faci la comandă?" };
  }

  if (intent === "order_cancel") {
    return { message: "Te rog confirmă dacă dorești anularea comenzii și oferă numărul comenzii." };
  }
}

module.exports = { handle };
