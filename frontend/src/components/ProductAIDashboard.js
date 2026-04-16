import React, { useState } from "react";

export default function ProductAIDashboard() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hi, I’m Turbo. How can I help you today?"
    }
  ]);

  const [input, setInput] = useState("");

  const sendMessage = () => {
    if (!input.trim()) return;

    const userMessage = { role: "user", content: input };

    // 🔹 Temporary mock response (we'll connect backend next)
    const assistantMessage = {
      role: "assistant",
      content: "Got it — I can help with that. Tell me more."
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput("");
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center py-10 px-4">

      {/* Header */}
      <div className="w-full max-w-2xl mb-6">
        <h2 className="text-xl font-semibold">Turbo</h2>
        <p className="text-sm text-gray-400">
          AI assistant for Carhub
        </p>
      </div>

      {/* Chat Container */}
      <div className="w-full max-w-2xl bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl shadow-2xl flex flex-col h-[520px]">

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-1">

          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[75%] px-4 py-2 rounded-xl text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-indigo-600 text-white"
                    : "bg-white/10 text-gray-200"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}

        </div>

        {/* Input Area */}
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 rounded-lg bg-black border border-white/10 text-white placeholder-gray-500 focus:outline-none"
          />

          <button
            onClick={sendMessage}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:opacity-90 transition"
          >
            Send
          </button>
        </div>

      </div>
    </div>
  );
}