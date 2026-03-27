(function () {
  const script = document.currentScript;
  const apiKey = script.getAttribute("data-key");

  let sessionId = localStorage.getItem("ai_session");
  if (!sessionId) {
    sessionId = Date.now().toString();
    localStorage.setItem("ai_session", sessionId);
  }

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.bottom = "20px";
  container.style.right = "20px";
  container.style.width = "320px";
  container.style.fontFamily = "Arial";

  const button = document.createElement("button");
  button.innerText = "💬 AI Consultant";
  button.style.width = "100%";
  button.style.padding = "10px";

  const chat = document.createElement("div");
  chat.style.display = "none";
  chat.style.background = "white";
  chat.style.height = "400px";

  const messages = document.createElement("div");
  messages.style.height = "300px";
  messages.style.overflowY = "auto";

  const input = document.createElement("input");
  input.style.width = "70%";

  const send = document.createElement("button");
  send.innerText = "Send";

  button.onclick = () => {
    chat.style.display = chat.style.display === "none" ? "block" : "none";
  };

  window.trackClick = function(productName) {
    fetch("http://192.168.0.160:3000/track-click", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        product: productName,
        session_id: sessionId
      })
    });
  };

  async function sendMessage() {
    const text = input.value;
    if (!text) return;

    messages.innerHTML += `<div><b>Tu:</b> ${text}</div>`;
    input.value = "";

    const res = await fetch("http://192.168.0.160:3000/chat", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        api_key: apiKey,
        message: text,
        session_id: sessionId
      })
    });

    const data = await res.json();

    messages.innerHTML += `<div><b>AI:</b><br>${data.reply}</div>`;

    if (data.products) {
      data.products.forEach(p => {
        const link = `${p.url}?source=ai&session_id=${sessionId}`;

        messages.innerHTML += `
          <div>
            🛒 <a href="${link}" target="_blank" onclick="trackClick('${p.name}')">
              ${p.name}
            </a> - ${p.price} lei
          </div>
        `;
      });
    }
  }

  send.onclick = sendMessage;

  chat.appendChild(messages);
  chat.appendChild(input);
  chat.appendChild(send);

  container.appendChild(button);
  container.appendChild(chat);

  document.body.appendChild(container);
})();
