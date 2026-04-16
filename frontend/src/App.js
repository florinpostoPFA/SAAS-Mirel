import React from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import ProductAIDashboard from "./components/ProductAIDashboard";
import SettingsPage from "./SettingsPage";
import TagSetupPage from "./TagSetupPage";

function Navigation() {
  return (
    <nav style={{ padding: "10px", marginBottom: "20px", borderBottom: "1px solid #ccc" }}>
      <Link to="/" style={{ marginRight: "20px" }}>Dashboard</Link>
      <Link to="/settings" style={{ marginRight: "20px" }}>Settings</Link>
      <Link to="/tag-setup">Tag Setup</Link>
    </nav>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Navigation />
      <Routes>
        <Route path="/" element={<ProductAIDashboard />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/tag-setup" element={<TagSetupPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
