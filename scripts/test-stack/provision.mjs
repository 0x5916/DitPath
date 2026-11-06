#!/usr/bin/env node
/**
 * Create disposable test accounts for the isolated DitPath stack.
 *
 * Accounts are registered through the real API, then marked verified with a
 * scoped SQL update because this environment deliberately has no external email
 * provider. Credentials live only in scripts/test-stack/runtime/ (mode 600).
 */
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

const args = process.argv.slice(2);
const command = args[0];
if (!["accounts", "show", "sample"].includes(command)) {
  console.error("usage: provision.mjs accounts|show|sample --runtime PATH");
  process.exit(2);
}
const runtimeIndex = args.indexOf("--runtime");
if (runtimeIndex < 0 || !args[runtimeIndex + 1]) {
  console.error("error: --runtime PATH is required");
  process.exit(2);
}
const runtime = path.resolve(args[runtimeIndex + 1]);
const stackEnvPath = path.join(runtime, "stack.env");
const accountsPath = path.join(runtime, "accounts.json");
const samplePath = path.join(runtime, "sample.json");

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index > 0) values[line.slice(0, index)] = line.slice(index + 1);
  }
  return values;
}

const env = parseEnv(await readFile(stackEnvPath, "utf8"));
const API = `http://127.0.0.1:${env.TEST_API_PORT}/v1`;
const DB_CONTAINER = "ditpath-final-acceptance-db";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(method, route, body, token, expected = 200) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
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
    if (response.status === 429 && attempt < 2) {
      const retry = Number(response.headers.get("retry-after") ?? "2");
      await sleep(Math.min(30, Math.max(1, retry)) * 1000);
      continue;
    }
    if (response.status !== expected) {
      throw new Error(
        `${method} ${route.split("?")[0]} returned HTTP ${response.status}: ${text}`,
      );
    }
    return payload;
  }
  throw new Error(`${method} ${route.split("?")[0]} remained rate-limited`);
}

function markVerified(account) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,14}[A-Za-z0-9]$/.test(account.username)) {
    throw new Error(
      "Generated username is not safe to use in the test SQL fixture",
    );
  }
  const sql = `UPDATE users SET email_verified = true WHERE username = '${account.username}';`;
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      DB_CONTAINER,
      "psql",
      "-U",
      env.POSTGRES_USER,
      "-d",
      env.POSTGRES_DB,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

async function login(account) {
  const pair = await request("POST", "/auth/login", {
    identifier: account.username,
    password: account.password,
  });
  return pair.access_token;
}

async function createAccounts() {
  const accounts = {};
  for (const label of ["A", "B"]) {
    const suffix = crypto.randomBytes(3).toString("hex");
    const username = `final-${label.toLowerCase()}-${suffix}`;
    const account = {
      username,
      email: `${username}@example.invalid`,
      password: crypto.randomBytes(18).toString("base64url"),
    };
    await request("POST", "/auth/register", account);
    markVerified(account);
    const token = await login(account);
    const me = await request("GET", "/user/me", undefined, token);
    if (!me.email_verified) throw new Error(`${label} was not marked verified`);
    accounts[label] = account;
  }

  const record = {
    createdAt: new Date().toISOString(),
    api: API,
    accounts,
  };
  await mkdir(runtime, { recursive: true });
  await writeFile(accountsPath, `${JSON.stringify(record, null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(accountsPath, 0o600);
  return record;
}

async function loadAccounts() {
  return JSON.parse(await readFile(accountsPath, "utf8"));
}

function show(record) {
  console.log(`API: ${record.api}`);
  console.table(
    Object.fromEntries(
      Object.entries(record.accounts).map(([label, account]) => [
        label,
        {
          username: account.username,
          email: account.email,
          password: account.password,
        },
      ]),
    ),
  );
  console.log(`Credential file: ${accountsPath} (mode 600)`);
}

async function seedSample() {
  const saved = await loadAccounts();
  const a = saved.accounts.A;
  const b = saved.accounts.B;
  const tokenA = await login(a);
  const tokenB = await login(b);
  let marker = {};
  try {
    marker = JSON.parse(await readFile(samplePath, "utf8"));
  } catch {
    // No sample marker yet.
  }

  await request(
    "POST",
    "/settings/cw",
    { char_wpm: 22, eff_wpm: 12, freq: 620, start_delay: 0.5 },
    tokenA,
  );
  await request(
    "POST",
    "/settings/page",
    { language: "en", cur_lesson: 2 },
    tokenA,
  );

  const threads = await request("GET", "/forum/threads?limit=100");
  let thread = (threads.data ?? []).find(
    (item) => item.title === "Final acceptance sample thread",
  );
  if (!thread) {
    const created = await request(
      "POST",
      "/forum/threads",
      {
        category: "general",
        title: "Final acceptance sample thread",
        body: "This thread is disposable sample data for the local DitPath acceptance stack. Browse it, reply to it, and delete content during testing.",
      },
      tokenA,
      201,
    );
    thread = created.data;
    marker.thread_id = thread.id;
    await writeFile(samplePath, `${JSON.stringify(marker, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  const replies = await request(
    "GET",
    `/forum/threads/${thread.id}/replies?limit=100`,
  );
  if (!replies.data?.length) {
    await request(
      "POST",
      `/forum/threads/${thread.id}/replies`,
      { body: "A second verified test account can reply here." },
      tokenB,
      201,
    );
  }

  if (!marker.training_seeded) {
    const now = new Date();
    const endedAt = now.toISOString();
    const startedAt = new Date(now.getTime() - 10 * 60_000).toISOString();
    const practiceId = crypto.randomUUID();
    const guidedId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const clientId = crypto.randomUUID();
    const common = {
      curriculum_version: "koch-39-v1",
      lesson: 1,
      status: "completed",
      started_at: startedAt,
      ended_at: endedAt,
      char_wpm: 22,
      eff_wpm: 12,
      freq_hz: 620,
    };
    const practice = {
      ...common,
      session_id: practiceId,
      mode: "practice",
      prompt_count: 1,
      attempt_count: 1,
      event_ids: [],
      accuracy: 0.92,
      scoring_version: "practice-copy-v1",
    };
    const guided = {
      ...common,
      session_id: guidedId,
      mode: "guided",
      prompt_count: 1,
      attempt_count: 1,
      event_ids: [eventId],
    };
    const event = {
      id: eventId,
      session_id: guidedId,
      prompt_id: crypto.randomUUID(),
      prompt_kind: "recall",
      target_character: "K",
      entered_text: "K",
      is_correct: true,
      classification: "automatic",
      latency_ms: 980,
      replay_count: 0,
      input_mode: "keyboard",
      char_wpm: 22,
      eff_wpm: 12,
      freq_hz: 620,
      created_at: endedAt,
    };

    await request(
      "POST",
      "/training/sessions/batch",
      { schema_version: 1, client_id: clientId, sessions: [practice] },
      tokenA,
    );
    const eventResult = await request(
      "POST",
      "/training/events/batch",
      { schema_version: 2, client_id: clientId, events: [event] },
      tokenA,
    );
    if (!eventResult.acknowledged_ids?.includes(eventId)) {
      throw new Error(
        `sample event was not acknowledged: ${JSON.stringify(eventResult)}`,
      );
    }
    const sessionResult = await request(
      "POST",
      "/training/sessions/batch",
      { schema_version: 1, client_id: clientId, sessions: [guided] },
      tokenA,
    );
    if (!sessionResult.acknowledged_ids?.includes(guidedId)) {
      throw new Error(
        `sample session was not acknowledged: ${JSON.stringify(sessionResult)}`,
      );
    }
    marker.training_seeded = true;
    marker.sessions = {
      practice: practiceId,
      guided: guidedId,
      event: eventId,
    };
    await writeFile(samplePath, `${JSON.stringify(marker, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  console.log(`Sample thread: ${thread.id}`);
  console.log("Sample account A now has one practice and one guided session.");
  console.log(`Sample marker: ${samplePath} (mode 600)`);
}

if (command === "accounts") {
  const record = await createAccounts();
  show(record);
} else if (command === "show") {
  show(await loadAccounts());
} else {
  await seedSample();
}
