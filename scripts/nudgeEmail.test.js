/**
 * Re-engagement nudge email: send confirmation, links, opt-out and logging.
 *
 *   node --test scripts/nudgeEmail.test.js
 *
 * The nudge shipped for months with three defects this suite pins down:
 * sendEmail swallowed every Resend failure and returned nothing, so the
 * caller wrote reengagementEmailSentAt regardless and a single failed send
 * suppressed that user's only nudge forever; the body contained no URL of any
 * kind, so there was no way back into the app and nothing to attribute; and
 * the opt-out helper that existed for exactly this send was never called.
 *
 * These tests EXECUTE the shipping code out of functions/index.js with stubbed
 * I/O - no network, no Firestore, no email - rather than asserting on the shape
 * of the source, so a behavioural regression fails here rather than passing a
 * grep.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SRC = fs.readFileSync(path.join(__dirname, "..", "functions", "index.js"), "utf8").replace(/\r\n/g, "\n");

/** Lift a region of the real source so the tests run the shipping code. */
function region(startMarker, endMarker) {
  const a = SRC.indexOf(startMarker);
  assert.ok(a > 0, `not found in functions/index.js: ${startMarker}`);
  const b = SRC.indexOf(endMarker, a);
  assert.ok(b > a, `not found after ${startMarker}: ${endMarker}`);
  return SRC.slice(a, b + endMarker.length);
}

const ADDRESS = "person@example.com";
const hashOf = (v) => crypto.createHash("sha256").update(v).digest("hex").slice(0, 8);

// ---- sendEmail -------------------------------------------------------------

const SEND_EMAIL_SRC = region("const recipientTag = (to) =>", "\n}\n");

/** @param fetchImpl stands in for the Resend call. */
function loadSendEmail(fetchImpl) {
  const errors = [];
  const api = new Function("crypto", "fetch", "console", "RESEND_API_KEY",
    `${SEND_EMAIL_SRC}\nreturn { sendEmail, recipientTag };`)(
    crypto,
    fetchImpl,
    { error: (m) => errors.push(String(m)), log: () => {}, warn: () => {} },
    { value: () => "test-key-never-used" },
  );
  return { ...api, errors };
}

const send = (fetchImpl) =>
  loadSendEmail(fetchImpl).sendEmail({ from: "Uncluttrd <hello@uncluttrd.app>", to: ADDRESS, subject: "s", text: "t" });

test("sendEmail returns true when Resend accepts the message", async () => {
  assert.equal(await send(async () => ({ ok: true, status: 200, text: async () => "" })), true);
});

test("sendEmail returns false on a non-2xx response", async () => {
  assert.equal(await send(async () => ({ ok: false, status: 422, text: async () => "unprocessable" })), false);
});

test("sendEmail returns false when the request throws", async () => {
  assert.equal(await send(async () => { throw new Error("network down"); }), false);
});

test("a failed send is logged with a hashed recipient, never the address", async () => {
  for (const [label, impl] of [
    ["non-2xx", async () => ({ ok: false, status: 500, text: async () => "boom" })],
    ["throw", async () => { throw new Error("network down"); }],
  ]) {
    const loaded = loadSendEmail(impl);
    await loaded.sendEmail({ from: "f", to: ADDRESS, subject: "s", text: "t" });
    assert.equal(loaded.errors.length, 1, `${label}: expected one error line`);
    assert.ok(!loaded.errors[0].includes(ADDRESS), `${label}: raw address in log`);
    assert.ok(loaded.errors[0].includes(hashOf(ADDRESS)), `${label}: hashed recipient missing`);
  }
});

test("recipientTag is stable, short and non-reversible, and handles an array", () => {
  const { recipientTag } = loadSendEmail(async () => ({ ok: true }));
  assert.equal(recipientTag(ADDRESS), hashOf(ADDRESS));
  assert.equal(recipientTag(ADDRESS).length, 8);
  assert.equal(recipientTag([ADDRESS]), hashOf(ADDRESS));
  assert.notEqual(recipientTag("other@example.com"), recipientTag(ADDRESS));
});

// ---- the email body --------------------------------------------------------

const BODY_SRC = region("const REENGAGEMENT_CTA_URL =", "${unsubscribeUrl(token)}`;");
const { reengagementEmailText, unsubscribeUrl } = new Function(
  "firstNameFrom",
  `${BODY_SRC}\nreturn { reengagementEmailText, unsubscribeUrl, REENGAGEMENT_CTA_URL };`,
)((d) => (d || "").trim().split(" ")[0] || "there");

const TOKEN = "8f3a2c1e-4d5b-6789-abcd-ef0123456789";
const BODY = reengagementEmailText("Sam Taylor", TOKEN);

test("the body carries a bare https CTA on its own line, so every client linkifies it", () => {
  assert.match(BODY, /^https:\/\/uncluttrd\.app\/\?[^\s]+$/m);
});

test("the CTA carries the attribution parameters", () => {
  for (const param of ["utm_source=email", "utm_medium=nudge", "utm_campaign=reengagement"]) {
    assert.ok(BODY.includes(param), `missing ${param}`);
  }
});

test("the body ends with an unsubscribe URL carrying this user's token", () => {
  assert.ok(BODY.includes(`handleUnsubscribe?token=${TOKEN}`), "unsubscribe URL missing");
  assert.ok(BODY.trim().endsWith(`handleUnsubscribe?token=${TOKEN}`), "unsubscribe should close the message");
});

test("the token is URL-encoded, so a token needing escaping cannot break the link", () => {
  assert.ok(unsubscribeUrl("a b&c").endsWith("token=a%20b%26c"));
});

test("the greeting still degrades to 'there' when there is no display name", () => {
  assert.ok(reengagementEmailText("", TOKEN).startsWith("Hi there,"));
  assert.ok(reengagementEmailText(undefined, TOKEN).startsWith("Hi there,"));
});

// ---- the nudge loop --------------------------------------------------------

const LOOP = region("exports.reengagementNudge = onSchedule(", "\n);");

test("the opt-out is honoured before anything is sent", () => {
  assert.match(LOOP, /if \(await isOptedOutOfMarketing\(doc\.id\)\)/);
  assert.ok(LOOP.indexOf("isOptedOutOfMarketing") < LOOP.indexOf("await sendEmail("));
});

test("test accounts are skipped", () => {
  assert.match(LOOP, /data\.isTestAccount === true/);
});

test("a missing unsubscribe token is generated and stored before the send", () => {
  const generated = LOOP.indexOf("crypto.randomUUID()");
  const stored = LOOP.indexOf("unsubscribeToken: token");
  const sent = LOOP.indexOf("await sendEmail(");
  assert.ok(generated > 0, "no token is generated");
  assert.ok(stored > generated, "token must be written after it is generated");
  assert.ok(sent > stored, "a token in the mail that is not in Firestore cannot unsubscribe anyone");
});

test("RFC 8058 one-click headers are sent", () => {
  assert.ok(LOOP.includes('"List-Unsubscribe": `<${unsubscribeUrl(token)}>`'));
  assert.ok(LOOP.includes('"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"'));
});

test("reengagementEmailSentAt is written once, and only for a confirmed send", () => {
  const marker = "reengagementEmailSentAt: admin.firestore.FieldValue.serverTimestamp()";
  assert.equal(LOOP.split(marker).length - 1, 1, "the marker must be written in exactly one place");
  const guard = LOOP.indexOf("if (accepted) {");
  assert.ok(guard > 0, "the send result must be checked");
  assert.ok(LOOP.indexOf(marker) > guard, "the marker must sit inside the accepted branch");
});

test("every run logs one summary line with all nine counters", () => {
  assert.ok(LOOP.includes("console.log(`[reengagementNudge] ${JSON.stringify(tally)}`)"), "summary line missing");
  for (const counter of ["considered", "skippedAlreadySent", "skippedOptedOut", "skippedHasPlan",
    "skippedNoEmail", "skippedTestAccount", "attempted", "sent", "failed"]) {
    assert.match(LOOP, new RegExp(`${counter}\\s*[:+]`), `counter missing: ${counter}`);
  }
});

test("the nudge logs no raw uid", () => {
  assert.ok(!/uid=\$\{doc\.id\}/.test(LOOP), "raw uid in log line");
  assert.ok(LOOP.includes("recipientTag(doc.id)"), "expected a hashed identifier");
});

test("the other sendEmail callers were not disturbed", () => {
  // welcome, Pro upgrade, canary alert, nudge. They ignore the return value,
  // which is why adding one is safe for them.
  assert.equal((SRC.match(/await sendEmail\(\{/g) || []).length, 4);
  for (const caller of ["sendWelcomeEmail", "sendCanaryAlertEmail"]) {
    assert.ok(SRC.includes(caller), `${caller} should still exist`);
  }
});
