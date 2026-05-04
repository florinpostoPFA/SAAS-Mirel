/**
 * Pure rubric evaluation for Top 25 prompt regression (Notion deliverable).
 * @param {object} entry — last interaction row (decision, output, lowSignalDetected, …)
 * @param {object} expectSpec — case.expect from top25_prompt_cases.json
 * @returns {{ pass: boolean, failures: string[] }}
 */
function evaluateTop25Expectation(entry, expectSpec) {
  const failures = [];
  if (!expectSpec || typeof expectSpec !== "object") {
    return { pass: true, failures: [] };
  }

  const d = entry && entry.decision ? entry.decision : {};
  const out = entry && entry.output ? entry.output : {};
  const action = d.action != null ? String(d.action) : "";
  const missingSlot = d.missingSlot === undefined ? undefined : d.missingSlot;
  const flowId = d.flowId === undefined ? undefined : d.flowId;
  const productsLen = typeof out.productsLength === "number" ? out.productsLength : 0;
  const productsReason = d.productsReason != null ? d.productsReason : out.productsReason;

  if (expectSpec.actionMustBe != null) {
    if (action !== String(expectSpec.actionMustBe)) {
      failures.push(`action: got "${action}", expected "${expectSpec.actionMustBe}"`);
    }
  }

  if (Array.isArray(expectSpec.actionAnyOf) && expectSpec.actionAnyOf.length > 0) {
    const allowed = expectSpec.actionAnyOf.map((x) => String(x));
    if (!allowed.includes(action)) {
      failures.push(`action: got "${action}", expected one of [${allowed.join(", ")}]`);
    }
  }

  if (Array.isArray(expectSpec.missingSlotAnyOf)) {
    const allowed = expectSpec.missingSlotAnyOf.map((x) => (x === null ? null : String(x)));
    const ms = missingSlot === null || missingSlot === undefined ? null : String(missingSlot);
    const normalized = ms;
    const ok = allowed.some((a) => (a === null ? ms == null || ms === "" : a === normalized));
    if (!ok) {
      failures.push(
        `missingSlot: got ${JSON.stringify(missingSlot)}, expected one of [${allowed.map((x) => JSON.stringify(x)).join(", ")}]`
      );
    }
  }

  if (Array.isArray(expectSpec.flowIdAnyOf) && expectSpec.flowIdAnyOf.length > 0) {
    const allowed = expectSpec.flowIdAnyOf.map((x) => (x == null ? null : String(x)));
    const fid = flowId == null ? null : String(flowId);
    const ok = allowed.some((a) => a === fid);
    if (!ok) {
      failures.push(`flowId: got ${JSON.stringify(flowId)}, expected one of [${allowed.map(String).join(", ")}]`);
    }
  }

  if (Array.isArray(expectSpec.forbidActionAnyOf) && expectSpec.forbidActionAnyOf.length > 0) {
    for (const bad of expectSpec.forbidActionAnyOf) {
      if (action === String(bad)) {
        failures.push(`action must not be "${bad}"`);
      }
    }
  }

  if (Array.isArray(expectSpec.outputTypeAnyOf) && expectSpec.outputTypeAnyOf.length > 0) {
    const ot = out.type != null ? String(out.type) : "";
    if (!expectSpec.outputTypeAnyOf.map(String).includes(ot)) {
      failures.push(`output.type: got "${ot}", expected one of [${expectSpec.outputTypeAnyOf.join(", ")}]`);
    }
  }

  if (
    Array.isArray(expectSpec.ifZeroProductsThenProductsReasonAnyOf) &&
    productsLen === 0
  ) {
    const allowed = expectSpec.ifZeroProductsThenProductsReasonAnyOf;
    const pr = productsReason == null ? null : String(productsReason);
    const ok = allowed.some((a) => (a == null ? pr == null : String(a) === pr));
    if (!ok) {
      failures.push(
        `productsReason (0 products): got ${JSON.stringify(productsReason)}, expected one of [${allowed.map(String).join(", ")}]`
      );
    }
  }

  return { pass: failures.length === 0, failures };
}

/**
 * @param {object} session — session blob from sessionStore.getSession
 * @param {object} sessionSpec — case.expect.sessionSlots
 */
function evaluateSessionSlots(session, sessionSpec) {
  const failures = [];
  if (!sessionSpec || typeof sessionSpec !== "object") {
    return { pass: true, failures: [] };
  }
  const slots = session && session.slots && typeof session.slots === "object" ? session.slots : {};
  const obj = slots.object != null ? String(slots.object).toLowerCase() : null;

  if (sessionSpec.objectNot != null) {
    const forbidden = String(sessionSpec.objectNot).toLowerCase();
    if (obj === forbidden) {
      failures.push(`session.slots.object must not be "${sessionSpec.objectNot}" (got ${JSON.stringify(slots.object)})`);
    }
  }

  return { pass: failures.length === 0, failures };
}

module.exports = { evaluateTop25Expectation, evaluateSessionSlots };
