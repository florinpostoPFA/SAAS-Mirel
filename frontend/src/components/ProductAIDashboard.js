import React, { useState } from "react";

const NEGATIVE_FEEDBACK_REASONS = [
  "wrong products",
  "confusing answer",
  "too many questions",
  "not helpful",
];

function sendFeedback(messageId, feedback) {
  fetch(`${process.env.REACT_APP_API_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messageId,
      feedback,
    }),
  }).catch((error) => {
    console.error("Error sending feedback:", error);
  });
}

/**
 * @typedef {{
 *   helpful: boolean,
 *   reason?: string
 * }} MessageFeedback
 */

/**
 * @typedef {{
 *   id: string,
 *   text: string,
 *   feedback?: MessageFeedback,
 *   showNegativeOptions?: boolean,
 *   selectedReason?: string,
 *   customReason?: string,
 *   role?: "user" | "assistant"
 * }} ChatMessage
 */

function createMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const DASHBOARD_SESSION_STORAGE_KEY = "ai_dashboard_session";

function getOrCreateDashboardSessionId() {
  try {
    let id = localStorage.getItem(DASHBOARD_SESSION_STORAGE_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      localStorage.setItem(DASHBOARD_SESSION_STORAGE_KEY, id);
    }
    return id;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

export default function ProductAIDashboard() {
  /** @type {[ChatMessage[], React.Dispatch<React.SetStateAction<ChatMessage[]>>]} */
  const [messages, setMessages] = useState([
    {
      id: createMessageId(),
      role: "assistant",
      text: "Salut, sunt Turbo. Cu ce te pot ajuta astazi?"
    }
  ]);

  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState(getOrCreateDashboardSessionId);

  const onFeedback = (messageId, helpful) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId
          ? helpful
            ? {
                ...message,
                feedback: {
                  helpful: true,
                },
                showNegativeOptions: false,
              }
            : {
                ...message,
                showNegativeOptions: true,
              }
          : message
      )
    );

    if (helpful) {
      sendFeedback(messageId, { helpful: true });
    }
  };

  const onNegativeReasonSelect = (messageId, reason) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId
          ? {
              ...message,
              selectedReason: reason,
            }
          : message
      )
    );
  };

  const onNegativeCustomReasonChange = (messageId, value) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId
          ? {
              ...message,
              customReason: value,
            }
          : message
      )
    );
  };

  const onNegativeSubmit = (messageId) => {
    let feedbackPayload = { helpful: false };

    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId) {
          return message;
        }

        const selectedReason = (message.selectedReason || "").trim();
        const customReason = (message.customReason || "").trim();
        const reason = selectedReason || customReason;

        feedbackPayload = reason
          ? { helpful: false, reason }
          : { helpful: false };

        return {
          ...message,
          feedback: feedbackPayload,
          showNegativeOptions: false,
        };
      })
    );

    sendFeedback(messageId, feedbackPayload);
  };

  const sendMessage = async () => {
    console.log("STEP 1");

    if (!input.trim()) return;

    /** @type {ChatMessage} */
    const userMessage = {
      id: createMessageId(),
      role: "user",
      text: input,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    try {
      console.log("STEP 2 - before fetch");

      const response = await fetch(`${process.env.REACT_APP_API_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: input, sessionId }),
      });

      console.log("STEP 3 - after fetch");

      const data = await response.json();

      if (data.sessionId && data.sessionId !== sessionId) {
        try {
          localStorage.setItem(DASHBOARD_SESSION_STORAGE_KEY, data.sessionId);
        } catch {
          /* ignore */
        }
        setSessionId(data.sessionId);
      }

      const assistantMessage = {
        id: createMessageId(),
        role: "assistant",
        text: data.reply || "Nu am putut genera un raspuns.",
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Error calling backend:", error);

      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          role: "assistant",
          text: "A aparut o eroare.",
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
              key={msg.id || index}
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
                {msg.text}

                {msg.role === "assistant" && (
                  <div className="mt-2 text-xs">
                    {!msg.feedback ? (
                      msg.showNegativeOptions ? (
                        <div className="mt-2 space-y-2">
                          <div className="flex flex-wrap gap-2">
                            {NEGATIVE_FEEDBACK_REASONS.map((reason) => (
                              <button
                                key={reason}
                                type="button"
                                onClick={() => onNegativeReasonSelect(msg.id, reason)}
                                className={`px-2 py-1 rounded transition ${
                                  msg.selectedReason === reason
                                    ? "bg-amber-500/30 text-amber-200"
                                    : "bg-white/10 hover:bg-white/20"
                                }`}
                              >
                                {reason}
                              </button>
                            ))}
                          </div>

                          <input
                            type="text"
                            value={msg.customReason || ""}
                            onChange={(e) => onNegativeCustomReasonChange(msg.id, e.target.value)}
                            placeholder="What was wrong?"
                            className="w-full px-2 py-1 rounded bg-black border border-white/20 text-white placeholder-gray-400"
                          />

                          <button
                            type="button"
                            onClick={() => onNegativeSubmit(msg.id)}
                            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition"
                          >
                            Submit
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => onFeedback(msg.id, true)}
                            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition"
                          >
                            👍
                          </button>
                          <button
                            type="button"
                            onClick={() => onFeedback(msg.id, false)}
                            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition"
                          >
                            👎
                          </button>
                        </div>
                      )
                    ) : msg.feedback.helpful ? (
                      <span className="text-green-300">👍 Thanks!</span>
                    ) : (
                      <span className="text-amber-300">👎 Noted</span>
                    )}
                  </div>
                )}
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