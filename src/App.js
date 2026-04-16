import { BrowserRouter as Router, Routes, Route, Link } from "react-router-dom";
import ProductAIDashboard from "./ProductAIDashboard";
import SettingsPage from "./SettingsPage";

function Navigation() {
  return (
    <nav style={{ padding: 10, borderBottom: "1px solid #ccc" }}>
      <Link to="/">Dashboard</Link> |{" "}
      <Link to="/settings">Settings</Link>
    </nav>
  );
}

function DashboardRoute() {
  return (
    <>
      <Navigation />
      <ProductAIDashboard />
    </>
  );
}

function SettingsRoute() {
  return (
    <>
      <Navigation />
      <SettingsPage />
    </>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<DashboardRoute />} />
        <Route path="/settings" element={<SettingsRoute />} />
      </Routes>
    </Router>
  );
}

export default App;
