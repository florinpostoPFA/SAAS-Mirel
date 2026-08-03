import React, { Suspense, lazy, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ProductAIDashboard from "./components/ProductAIDashboard";
import SettingsPage from "./SettingsPage";
import TagSetupPage from "./TagSetupPage";
import ErrorBoundary from "./components/ErrorBoundary";
import SiteLayout from "./components/SiteLayout";
import HomePage from "./pages/HomePage";
import AboutPage from "./pages/AboutPage";
import ContactPage from "./pages/ContactPage";
import PortfolioPage from "./pages/PortfolioPage";

const BlogIndexPage = lazy(() => import("./pages/BlogIndexPage"));
const BlogPostPage = lazy(() => import("./pages/BlogPostPage"));
const BlogLayout = lazy(() => import("./blog/BlogLayout"));

function BlogRouteFallback() {
  return (
    <div className="min-h-screen bg-[#0a0f1c] px-6 py-16 text-slate-400">
      <p className="mx-auto max-w-3xl">Loading…</p>
    </div>
  );
}

// 🔹 Password Page (Turbo gate — keep live; not linked from public nav)
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
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <SiteLayout>
                <HomePage />
              </SiteLayout>
            }
          />
          <Route
            path="/about"
            element={
              <SiteLayout>
                <AboutPage />
              </SiteLayout>
            }
          />
          <Route
            path="/contact"
            element={
              <SiteLayout>
                <ContactPage />
              </SiteLayout>
            }
          />
          <Route
            path="/portfolio"
            element={
              <SiteLayout>
                <PortfolioPage />
              </SiteLayout>
            }
          />
          <Route
            path="/blog"
            element={
              <Suspense fallback={<BlogRouteFallback />}>
                <BlogLayout>
                  <BlogIndexPage />
                </BlogLayout>
              </Suspense>
            }
          />
          <Route
            path="/blog/:slug"
            element={
              <Suspense fallback={<BlogRouteFallback />}>
                <BlogLayout>
                  <BlogPostPage />
                </BlogLayout>
              </Suspense>
            }
          />
          <Route path="/assistant/carhub" element={<Password />} />
          <Route path="/assistant/carhub/*" element={<ProtectedApp />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
