import { useState } from "react";

const CHAT_ENDPOINT = "http://192.168.0.160:3001/chat";

export default function ProductAIDashboard() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  const sendMessage = async () => {
    const userInput = message.trim();

    if (!userInput || isSending) {
      return;
    }

    const userMessage = {
      id: `${Date.now()}_user`,
      role: "user",
      content: userInput,
    };

    setMessages((prev) => [...prev, userMessage]);
    setMessage("");
    setError("");
    setIsSending(true);

    try {
      const response = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: userInput,
        }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || "Failed to get AI response.");
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}_ai`,
          role: "ai",
          content: data.reply || "No response from AI.",
        },
      ]);
    } catch (requestError) {
      const errorMessage = requestError.message || "Network error.";
      setError(errorMessage);
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}_error`,
          role: "ai",
          content: `Error: ${errorMessage}`,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = async (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await sendMessage();
    }
  };

  return (
    <div style={{ padding: "24px", maxWidth: "900px", margin: "0 auto", fontFamily: "Arial, sans-serif" }}>
      <h1>Chat Testing</h1>
      <p>Send a message to the backend chat endpoint and review the AI response.</p>

      <div
        style={{
          border: "1px solid #ccc",
          borderRadius: "8px",
          minHeight: "320px",
          padding: "16px",
          marginBottom: "16px",
          backgroundColor: "#fafafa",
        }}
      >
        {messages.length === 0 ? (
          <p style={{ margin: 0, color: "#666" }}>No messages yet.</p>
        ) : (
          messages.map((entry) => (
            <div
              key={entry.id}
              style={{
                marginBottom: "12px",
                padding: "12px",
                borderRadius: "6px",
                backgroundColor: entry.role === "user" ? "#e8f0fe" : "#ffffff",
                border: "1px solid #ddd",
              }}
            >
              <strong>{entry.role === "user" ? "You" : "AI"}</strong>
              <div style={{ marginTop: "6px", whiteSpace: "pre-wrap" }}>{entry.content}</div>
            </div>
          ))
        )}
      </div>

      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={4}
          style={{
            flex: 1,
            padding: "12px",
            borderRadius: "6px",
            border: "1px solid #ccc",
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />

        <button
          type="button"
          onClick={sendMessage}
          disabled={isSending || !message.trim()}
          style={{
            padding: "12px 20px",
            borderRadius: "6px",
            border: "1px solid #333",
            backgroundColor: isSending ? "#ccc" : "#333",
            color: "#fff",
            cursor: isSending ? "not-allowed" : "pointer",
          }}
        >
          {isSending ? "Sending..." : "Send"}
        </button>
      </div>

      {error && <p style={{ color: "#b00020", marginTop: "12px" }}>{error}</p>}
    </div>
  );
}
