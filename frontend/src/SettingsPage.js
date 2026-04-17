import React, { useEffect, useState } from "react";

const API_KEY = "your-secret-key";

export default function SettingsPage() {
  // Recommendation Settings
  const [maxProducts, setMaxProducts] = useState(5);
  const [delayRecommendation, setDelayRecommendation] = useState(false);

  // AI Behavior
  const [tone, setTone] = useState("friendly");
  const [responseStyle, setResponseStyle] = useState("short");
  const [salesMode, setSalesMode] = useState("soft");

  // Conversation Rules
  const [askQuestions, setAskQuestions] = useState(true);
  const [maxQuestions, setMaxQuestions] = useState(3);
  const [greetingEnabled, setGreetingEnabled] = useState(true);

  // Tag Rules
  const [tagRules, setTagRules] = useState("piele:leather\nalcantara:alcantara\nplastig:plastic");

  // CTA
  const [cta, setCta] = useState("View Product");

  useEffect(() => {
    fetch("http://192.168.0.160:3001/settings", {
      headers: {
        "x-api-key": API_KEY
      }
    })
      .then(res => res.json())
      .then(data => {
        if (!data) return;

        setMaxProducts(data.max_products || 3);
        setDelayRecommendation(data.delay_recommendation || false);
        setTone(data.tone || "friendly");
        setResponseStyle(data.response_style || "persuasive");
        setSalesMode(data.sales_mode || "soft");
        setAskQuestions(data.ask_questions || true);
        setMaxQuestions(data.max_questions || 2);
        setGreetingEnabled(data.greeting_enabled || true);
        setTagRules(data.tagRules || "");
        setCta(data.cta || "Vezi produsul");
      });
  }, []);

  const handleSave = () => {
    const max_products = parseInt(maxProducts, 10);
    const delay_recommendation = delayRecommendation;
    const response_style = responseStyle;
    const sales_mode = salesMode;
    const ask_questions = askQuestions;
    const max_questions = parseInt(maxQuestions, 10);
    const greeting_enabled = greetingEnabled;

    fetch("http://192.168.0.160:3001/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY
      },
      body: JSON.stringify({
        max_products,
        delay_recommendation,
        tone,
        response_style,
        sales_mode,
        ask_questions,
        max_questions,
        greeting_enabled,
        tagRules,
        cta,
      }),
    })
      .then(res => res.json())
      .then(data => {
        console.log("Saved:", data);
      });
  };

  const sectionStyle = {
    marginBottom: "30px",
    padding: "15px",
    backgroundColor: "#f9f9f9",
    borderRadius: "4px"
  };

  const fieldStyle = {
    marginBottom: "12px"
  };

  const labelStyle = {
    display: "block",
    marginBottom: "5px",
    fontWeight: "bold",
    fontSize: "14px"
  };

  const inputStyle = {
    padding: "8px",
    border: "1px solid #ccc",
    borderRadius: "4px",
    fontSize: "14px"
  };

  const checkboxStyle = {
    marginRight: "8px",
    cursor: "pointer"
  };

  return (
    <div style={{ padding: "20px", maxWidth: "700px" }}>
      <h1>Settings</h1>

      {/* Recommendation Settings */}
      <div style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>Recommendation Settings</h2>
        
        <div style={fieldStyle}>
          <label style={labelStyle}>Max Products</label>
          <input
            type="number"
            value={maxProducts}
            onChange={(e) => setMaxProducts(e.target.value)}
            min="1"
            max="20"
            style={{ ...inputStyle, width: "100px" }}
          />
        </div>

        <div style={fieldStyle}>
          <label>
            <input
              type="checkbox"
              checked={delayRecommendation}
              onChange={(e) => setDelayRecommendation(e.target.checked)}
              style={checkboxStyle}
            />
            Delay Recommendation
          </label>
        </div>
      </div>

      {/* AI Behavior */}
      <div style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>AI Behavior</h2>
        
        <div style={fieldStyle}>
          <label style={labelStyle}>Tone</label>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            style={{ ...inputStyle, minWidth: "150px" }}
          >
            <option value="friendly">Friendly</option>
            <option value="expert">Expert</option>
          </select>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Response Style</label>
          <select
            value={responseStyle}
            onChange={(e) => setResponseStyle(e.target.value)}
            style={{ ...inputStyle, minWidth: "150px" }}
          >
            <option value="short">Short</option>
            <option value="detailed">Detailed</option>
            <option value="persuasive">Persuasive</option>
          </select>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Sales Mode</label>
          <select
            value={salesMode}
            onChange={(e) => setSalesMode(e.target.value)}
            style={{ ...inputStyle, minWidth: "150px" }}
          >
            <option value="soft">Soft</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </div>
      </div>

      {/* Conversation Rules */}
      <div style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>Conversation Rules</h2>
        
        <div style={fieldStyle}>
          <label>
            <input
              type="checkbox"
              checked={askQuestions}
              onChange={(e) => setAskQuestions(e.target.checked)}
              style={checkboxStyle}
            />
            Ask Questions
          </label>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Max Questions</label>
          <input
            type="number"
            value={maxQuestions}
            onChange={(e) => setMaxQuestions(e.target.value)}
            min="0"
            max="10"
            style={{ ...inputStyle, width: "100px" }}
          />
        </div>

        <div style={fieldStyle}>
          <label>
            <input
              type="checkbox"
              checked={greetingEnabled}
              onChange={(e) => setGreetingEnabled(e.target.checked)}
              style={checkboxStyle}
            />
            Greeting Enabled
          </label>
        </div>
      </div>

      {/* Tag Rules */}
      <div style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>Tag Rules</h2>
        <p style={{ color: "#666", fontSize: "14px", marginTop: 0 }}>
          Each line format: keyword:tag
        </p>
        <textarea
          value={tagRules}
          onChange={(e) => setTagRules(e.target.value)}
          rows={6}
          style={{
            ...inputStyle,
            width: "100%",
            fontFamily: "monospace",
            boxSizing: "border-box"
          }}
        />
      </div>

      {/* CTA */}
      <div style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>Call-to-Action</h2>
        
        <div style={fieldStyle}>
          <label style={labelStyle}>CTA Text</label>
          <input
            type="text"
            value={cta}
            onChange={(e) => setCta(e.target.value)}
            placeholder="e.g., View Product"
            style={{ ...inputStyle, width: "100%" }}
          />
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        style={{
          padding: "12px 24px",
          backgroundColor: "#007bff",
          color: "white",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "16px",
          fontWeight: "bold"
        }}
      >
        Save Settings
      </button>
    </div>
  );
}
