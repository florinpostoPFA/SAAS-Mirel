const http = require("http");

const BASE_URL = "http://localhost:3001";

function makeRequest(path, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      }
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          resolve({ raw: data });
        }
      });
    });

    req.on("error", reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function runTests() {
  const tests = [
    {
      name: "A1: interior jante",
      message: "Jantele mele sunt foarte murdare. Cum le curat in interior?",
      expected: {
        hasPrefix: true,
        prefixContains: ["Jantele sunt la exterior", "Te ajut cu curatarea"],
        shouldRoute: true,
        shouldNotAsk: true
      }
    },
    {
      name: "A2: exterior scaun",
      message: "Exterior scaun, trebuie sa il curat! Cum fac?",
      expected: {
        hasPrefix: true,
        prefixContains: ["Scaunele sunt la interior", "Te ajut"],
        shouldRoute: true,
        shouldNotAsk: true
      }
    },
    {
      name: "A3: exterior bord",
      message: "Bordul din afara, cum se curata?",
      expected: {
        hasPrefix: true,
        prefixContains: ["Bordul este la interior"],
        shouldRoute: true,
        shouldNotAsk: true
      }
    },
    {
      name: "A4: exterior mocheta",
      message: "Mocheta in exterior, ce fac?",
      expected: {
        hasPrefix: true,
        prefixContains: ["Mocheta este la interior"],
        shouldRoute: true,
        shouldNotAsk: true
      }
    },
    {
      name: "A5: interior caroserie",
      message: "Caroseria din interior trebuie curatata",
      expected: {
        hasPrefix: true,
        prefixContains: ["Caroseria este la exterior"],
        shouldRoute: true,
        shouldNotAsk: true
      }
    },
    {
      name: "B1: jante only",
      message: "Jantele sunt pline de noroi. Cum le curat?",
      expected: {
        contextInferred: "exterior",
        shouldRoute: true
      }
    },
    {
      name: "B2: caroserie only",
      message: "Trebuie sa curat caroseria masini",
      expected: {
        contextInferred: "exterior",
        shouldRoute: true
      }
    },
    {
      name: "C1: mocheta only",
      message: "Mocheta interioara, cum se curata?",
      expected: {
        surfaceInferred: "textile",
        shouldRoute: true
      }
    },
    {
      name: "C2: parbriz only",
      message: "Parbrizul este murdar. Cum il spel?",
      expected: {
        surfaceInferred: "glass",
        shouldRoute: true
      }
    },
    {
      name: "D1: scaun vopsea",
      message: "Scaun vopsea cum se curata?",
      expected: {
        shouldBlock: true,
        askQuestion: "Scaunele nu sunt din vopsea"
      }
    },
    {
      name: "D2: geam piele",
      message: "Geam piele, cum se curata?",
      expected: {
        shouldBlock: true,
        askQuestion: "nu sunt din piele"
      }
    },
    {
      name: "D3: jante textile",
      message: "Jante textile, vreau sa le curat",
      expected: {
        shouldBlock: true,
        askQuestion: "nu sunt din textile"
      }
    },
    {
      name: "E1: unknown object aripa",
      message: "Interior aripa, cum se curata?",
      expected: {
        shouldNotRoute: true,
        shouldAsk: true
      }
    },
    {
      name: "F1: Turn 1 - interior jante",
      message: "Jante in interior, ajuta-ma!",
      session: "test-f1",
      expected: {
        hasPrefix: true,
        prefixContains: ["Jantele sunt la exterior"]
      }
    },
    {
      name: "F2: Turn 2 - scaun textile (should NOT have old prefix)",
      message: "Scaun textile, cum se curata?",
      session: "test-f1",
      expected: {
        hasPrefix: false,
        shouldNotContain: ["Jantele sunt la exterior"]
      }
    }
  ];

  console.log("=== SLOT VALIDATION TEST SUITE ===\n");

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const sessionId = test.session || `session-${Math.random().toString(36).substr(2, 9)}`;
    try {
      const response = await makeRequest("/chat", {
        message: test.message,
        sessionId: sessionId,
        language: "ro"
      });

      console.log(`\n[${test.name}]`);

      // Add delay between requests to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1500));

      console.log(`\n[${test.name}]`);
      console.log(`  Message: "${test.message}"`);

      let testPassed = true;
      const details = [];

      // Extract response text
      const responseText =
        response?.data?.reply ||
        response?.data?.message ||
        (response?.reply ? response.reply : JSON.stringify(response));

      details.push(`  Response: "${responseText.substring(0, 120)}${responseText.length > 120 ? "..." : ""}"`);

      // Check prefix expectations
      if (test.expected.hasPrefix !== undefined) {
        const hasPrefixMatch = test.expected.prefixContains
          ? test.expected.prefixContains.some((p) =>
              responseText.toLowerCase().includes(p.toLowerCase())
            )
          : test.expected.hasPrefix;

        if (test.expected.hasPrefix && !hasPrefixMatch) {
          details.push(`  ❌ Expected prefix not found`);
          testPassed = false;
        } else if (!test.expected.hasPrefix && hasPrefixMatch) {
          details.push(`  ❌ Unexpected prefix found`);
          testPassed = false;
        } else {
          details.push(`  ✅ Prefix check passed`);
        }
      }

      // Check routing
      if (test.expected.shouldRoute !== undefined) {
        const isQuestion =
          response?.data?.type === "question" ||
          responseText.includes("?");
        if (test.expected.shouldRoute && isQuestion) {
          details.push(`  ⚠️  Expected routing but got clarification question`);
        } else if (test.expected.shouldRoute) {
          details.push(`  ✅ Routing confirmed (not a question)`);
        }
      }

      if (test.expected.shouldNotAsk !== undefined && test.expected.shouldNotAsk) {
        const isQuestion =
          response?.data?.type === "question" ||
          responseText.includes("?");
        if (isQuestion) {
          details.push(`  ❌ Should not ask but got question`);
          testPassed = false;
        } else {
          details.push(`  ✅ No unwanted question`);
        }
      }

      // Check context inference
      if (test.expected.contextInferred !== undefined) {
        if (responseText.toLowerCase().includes(test.expected.contextInferred.toLowerCase())) {
          details.push(`  ✅ Context inferred correctly`);
        } else {
          details.push(`  ❌ Context not inferred`);
          testPassed = false;
        }
      }

      // Check surface inference
      if (test.expected.surfaceInferred !== undefined) {
        if (responseText.toLowerCase().includes(test.expected.surfaceInferred.toLowerCase())) {
          details.push(`  ✅ Surface inferred correctly`);
        } else {
          details.push(`  ❌ Surface not inferred`);
          testPassed = false;
        }
      }

      // Check blocking for invalid combinations
      if (test.expected.shouldBlock !== undefined && test.expected.shouldBlock) {
        const isQuestion = responseText.includes("?");
        if (!isQuestion) {
          details.push(`  ❌ Expected blocking question but got routing`);
          testPassed = false;
        } else {
          details.push(`  ✅ Invalid combination blocked`);
          if (test.expected.askQuestion && responseText.includes(test.expected.askQuestion)) {
            details.push(`  ✅ Question text correct`);
          } else if (test.expected.askQuestion) {
            details.push(`  ❌ Question text mismatch`);
          }
        }
      }

      // Check for object or surface clarification
      if (test.expected.shouldAsk !== undefined && test.expected.shouldAsk) {
        const isQuestion = responseText.includes("?");
        if (!isQuestion) {
          details.push(`  ❌ Should ask but got routing`);
          testPassed = false;
        } else {
          details.push(`  ✅ Clarification question present`);
        }
      }

      console.log(details.join("\n"));

      if (testPassed) {
        passed++;
        console.log(`  PASSED ✅`);
      } else {
        failed++;
        console.log(`  FAILED ❌`);
      }
    } catch (err) {
      console.log(`\n[${test.name}]`);
      console.log(`  ❌ ERROR: ${err.message}`);
      failed++;
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Passed: ${passed}/${tests.length}`);
  console.log(`Failed: ${failed}/${tests.length}`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
