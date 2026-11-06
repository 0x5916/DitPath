#!/usr/bin/env node
/**
 * Real API acceptance checks against the isolated stack. This writes a small
 * amount of synthetic training/forum data; reset the stack afterwards when a
 * pristine database is required.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

const args = process.argv.slice(2);
const runtimeIndex = args.indexOf("--runtime");
if (runtimeIndex < 0 || !args[runtimeIndex + 1]) {
  console.error("error: --runtime PATH is required");
  process.exit(2);
}
const runtime = path.resolve(args[runtimeIndex + 1]);

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index > 0) values[line.slice(0, index)] = line.slice(index + 1);
  }
  return values;
}

const env = parseEnv(await readFile(path.join(runtime, "stack.env"), "utf8"));
const accounts = JSON.parse(
  await readFile(path.join(runtime, "accounts.json"), "utf8"),
).accounts;
const API = `http://127.0.0.1:${env.TEST_API_PORT}/v1`;
const checks = [];

function check(name) {
  checks.push(name);
  console.log(`PASS ${name}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(method, route, body, token, expected = 200) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${API}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (response.status === 429 && attempt < 3) {
      const retry = Number(response.headers.get("retry-after") ?? "2");
      await sleep(Math.min(30, Math.max(1, retry)) * 1000);
      continue;
    }
    if (response.status !== expected) {
      throw new Error(
        `${method} ${route.split("?")[0]} expected ${expected}, got ${response.status}: ${text}`,
      );
    }
    return payload;
  }
  throw new Error(`${method} ${route.split("?")[0]} remained rate-limited`);
}

async function login(account) {
  return request("POST", "/auth/login", {
    identifier: account.username,
    password: account.password,
  });
}

const health = await request("GET", "/health");
assert.equal(health.status, "healthy");
check("public health endpoint");

await request("GET", "/training/changes", undefined, undefined, 401);
check("training history requires authentication");

const a = await login(accounts.A);
const b = await login(accounts.B);
assert.equal(
  (await request("GET", "/user/me", undefined, a.access_token)).username,
  accounts.A.username,
);
assert.equal(
  (await request("GET", "/user/me", undefined, b.access_token)).username,
  accounts.B.username,
);
check("both test accounts authenticate with isolated identities");

await request(
  "POST",
  "/settings/cw",
  { char_wpm: 18, eff_wpm: 11, freq: 550, start_delay: 0.5 },
  b.access_token,
);
const bSettings = await request(
  "GET",
  "/settings/all",
  undefined,
  b.access_token,
);
assert.deepEqual(
  {
    char_wpm: bSettings.cw_settings.char_wpm,
    eff_wpm: bSettings.cw_settings.eff_wpm,
    freq: bSettings.cw_settings.freq,
    start_delay: bSettings.cw_settings.start_delay,
  },
  { char_wpm: 18, eff_wpm: 11, freq: 550, start_delay: 0.5 },
);
check("account settings round-trip");

const now = new Date();
const startedAt = new Date(now.getTime() - 120_000).toISOString();
const endedAt = now.toISOString();
const practice = {
  schema_version: 1,
  client_id: crypto.randomUUID(),
  sessions: [
    {
      session_id: crypto.randomUUID(),
      curriculum_version: "koch-39-v1",
      lesson: 2,
      mode: "practice",
      status: "completed",
      started_at: startedAt,
      ended_at: endedAt,
      char_wpm: 18,
      eff_wpm: 11,
      freq_hz: 550,
      prompt_count: 1,
      attempt_count: 1,
      event_ids: [],
      accuracy: 0.93,
      scoring_version: "practice-copy-v1",
    },
  ],
};
await request("POST", "/training/sessions/batch", practice, a.access_token);
check("authenticated training upload");

const historyA = await request(
  "GET",
  "/training/sessions?mode=practice&status=all&limit=100",
  undefined,
  a.access_token,
);
const savedA = historyA.sessions.find(
  (item) => item.session_id === practice.sessions[0].session_id,
);
assert.equal(savedA.accuracy, 0.93);
check("uploaded practice appears in account A history");

// The same native session ID is independently addressable by account B.
const practiceB = structuredClone(practice);
practiceB.sessions[0].accuracy = 0.42;
await request("POST", "/training/sessions/batch", practiceB, b.access_token);
const historyB = await request(
  "GET",
  "/training/sessions?mode=practice&status=all&limit=100",
  undefined,
  b.access_token,
);
const savedB = historyB.sessions.find(
  (item) => item.session_id === practice.sessions[0].session_id,
);
assert.equal(savedB.accuracy, 0.42);
assert.ok(
  historyB.sessions.every(
    (item) => item.session_id !== "sample-guided-not-present",
  ),
  "history response shape",
);
check("account B can store the same ID without reading A content");

const changesA = await request(
  "GET",
  "/training/changes?limit=100",
  undefined,
  a.access_token,
);
assert.ok(
  changesA.changes.some(
    (change) =>
      change.kind === "session" &&
      change.record.session_id === practice.sessions[0].session_id,
  ),
);
await request(
  "GET",
  `/training/changes?cursor=${encodeURIComponent(changesA.next_cursor)}&limit=1`,
  undefined,
  b.access_token,
  400,
);
check("change feed is scoped to the authenticated account");

const logout = await login(accounts.B);
await request("POST", "/auth/logout", { refresh_token: logout.refresh_token });
await request(
  "POST",
  "/auth/refresh",
  { refresh_token: logout.refresh_token },
  undefined,
  401,
);
check("logout revokes its refresh token");

const forum = await request("GET", "/forum/threads?limit=100");
assert.ok(Array.isArray(forum.data));
const title = `API acceptance ${crypto.randomBytes(4).toString("hex")}`;
const thread = await request(
  "POST",
  "/forum/threads",
  {
    category: "help",
    title,
    body: "Disposable full-stack API acceptance thread.",
  },
  a.access_token,
  201,
);
const threadId = thread.data.id;
const reply = await request(
  "POST",
  `/forum/threads/${threadId}/replies`,
  { body: "Account B reply through the real API." },
  b.access_token,
  201,
);
assert.ok(reply.data.id);
const replies = await request(
  "GET",
  `/forum/threads/${threadId}/replies?limit=100`,
);
assert.ok(replies.data.some((item) => item.id === reply.data.id));
check("forum thread and reply create/browse");

const suffix = crypto.randomBytes(3).toString("hex");
const unverified = {
  username: `final-c-${suffix}`,
  email: `final-c-${suffix}@example.invalid`,
  password: crypto.randomBytes(18).toString("base64url"),
};
const registered = await request("POST", "/auth/register", unverified);
assert.ok(registered.access_token);
const registeredMe = await request(
  "GET",
  "/user/me",
  undefined,
  registered.access_token,
);
assert.equal(registeredMe.email_verified, false);
await request(
  "POST",
  "/forum/threads",
  { category: "general", title: "Unverified must not post", body: "blocked" },
  registered.access_token,
  403,
);
check("registration and the unverified-forum gate");

await request(
  "DELETE",
  `/forum/threads/${threadId}`,
  undefined,
  a.access_token,
);
await request("GET", `/forum/threads/${threadId}`, undefined, undefined, 404);
check("forum author deletion");

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
