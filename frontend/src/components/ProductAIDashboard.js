import React, { useState } from "react";

export default function ProductAIDashboard() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hi, I’m Turbo. How can I help you today?"
    }
  ]);

  const [input, setInput] = useState("");

  const sendMessage = async () => {
    console.log("STEP 1");

    if (!input.trim()) return;

    const userMessage = { role: "user", content: input };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    try {
      console.log("STEP 2 - before fetch");

      const response = await fetch(`${process.env.REACT_APP_API_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: input }),
      });

      console.log("STEP 3 - after fetch");

      const data = await response.json();

      const assistantMessage = {
        role: "assistant",
        content: data.reply || "No response from server",
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Error calling backend:", error);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Error contacting server",
        },
      ]);
    }
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