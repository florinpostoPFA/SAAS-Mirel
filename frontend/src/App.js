import React, { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ProductAIDashboard from "./components/ProductAIDashboard";
import SettingsPage from "./SettingsPage";
import TagSetupPage from "./TagSetupPage";

// 🔹 Landing Page
function Landing() {
  return (
    <div className="min-h-screen bg-black text-white px-6 py-20">

      <div className="max-w-3xl mx-auto text-center">
        <h1 className="text-5xl font-semibold mb-6 tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
          AI assistants for eCommerce stores
        </h1>

        <p className="text-lg text-gray-400 mb-8">
          Each store gets its own assistant—trained on its products, able to guide customers and recommend the right choices.
        </p>

        <button
          onClick={() => window.location.href = "/assistant/carhub"}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg hover:opacity-90 transition"
        >
          Talk to Turbo
        </button>

        <p className="mt-3 text-sm text-gray-500">
          Live assistant: Turbo for Carhub
        </p>
      </div>

      <div className="max-w-2xl mx-auto mt-16 bg-gradient-to-b from-white/10 to-white/5 backdrop-blur-xl rounded-2xl border border-white/10 p-6 space-y-5 text-sm shadow-2xl">

        <div className="text-indigo-400">
          <span className="font-semibold">Turbo</span>
          <p className="text-white mt-1">
            Hi, I’m Turbo. I can help you explore options, compare them, and make better decisions.
          </p>
        </div>

        <div className="text-gray-400">
          <span className="font-semibold">User</span>
          <p className="mt-1">
            Cum curăț mașina la exterior?
          </p>
        </div>

        <div className="text-indigo-400">
          <span className="font-semibold">Turbo</span>
          <p className="text-white mt-1">
            Te pot ajuta — am nevoie de câteva detalii. Vrei să cureți vopseaua, geamurile sau toată mașina?
          </p>
        </div>

        <div className="text-gray-400">
          <span className="font-semibold">User</span>
          <p className="mt-1">
            Vreau să arate ca nouă
          </p>
        </div>

        <div className="text-indigo-400">
          <span className="font-semibold">Turbo</span>
          <p className="text-white mt-1">
            În cazul ăsta, îți recomand un pachet complet de detailing — pot să-ți explic ce include.
          </p>
        </div>

      </div>

      <div className="max-w-2xl mx-auto mt-20 text-center">
        <h2 className="text-2xl font-semibold mb-4">
          One assistant per store
        </h2>

        <p className="text-gray-400">
          Not a generic chatbot. Each assistant is built specifically for a single store—its catalog, tone, and customer needs.
        </p>

        <p className="text-gray-400 mt-3">
          We first feed it your business knowledge, so it understands your services, answers correctly, and can recommend the right options to your customers.
        </p>

        <p className="text-gray-500 mt-4 text-sm">
          Built for European businesses, with local context and European hosting.
        </p>
      </div>

    </div>
  );
}

// 🔹 Password Page
function Password() {
  const [password, setPassword] = useState("");

  const handleSubmit = () => {
    if (password === "turbo123") {
      localStorage.setItem("posto_access", "true");
      window.location.href = "/assistant/carhub/chat";
    } else {
      alert("Invalid password");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-black text-white text-center px-4">
      <h2 className="text-2xl font-semibold mb-2">Private Preview</h2>
      <p className="text-gray-400 mb-6">Turbo — Carhub’s AI assistant</p>

      <input
        type="password"
        placeholder="Enter access password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="border border-white/20 bg-black rounded-lg px-4 py-2 mb-4 w-64 text-white"
      />

      <button
        onClick={handleSubmit}
        className="px-5 py-2 rounded-lg bg-indigo-600 text-white hover:opacity-90"
      >
        Access assistant
      </button>
    </div>
  );
}

// 🔹 Protected Full App
function ProtectedApp() {
  const hasAccess = localStorage.getItem("posto_access");

  if (!hasAccess) {
    return <Navigate to="/assistant/carhub" />;
  }

  return (
    <div className="min-h-screen bg-black text-white p-4">
      {/* Simple Navigation */}
      <nav className="mb-6 border-b border-white/10 pb-3">
        <a href="/assistant/carhub/chat" className="mr-4 text-indigo-400">Chat</a>
        <a href="/assistant/carhub/settings" className="mr-4 text-gray-300">Settings</a>
        <a href="/assistant/carhub/tag-setup" className="text-gray-300">Tag Setup</a>
      </nav>

      <Routes>
        <Route path="chat" element={<ProductAIDashboard />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="tag-setup" element={<TagSetupPage />} />
      </Routes>
    </div>
  );
}

// 🔹 App Router
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/assistant/carhub" element={<Password />} />
        <Route path="/assistant/carhub/*" element={<ProtectedApp />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;