#!/usr/bin/env node
/**
 * Complete one real guided lesson in Chromium against the full stack, using a
 * deterministic Web Audio clock because headless browsers may have no device.
 * The browser, authentication, IndexedDB, controller and API are real.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
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
const baseURL = `http://127.0.0.1:${env.TEST_FRONTEND_PORT}`;
const EVIDENCE_DB = "opencw_learning_evidence_v1";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
});
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(String(error)));

await page.addInitScript(() => {
  class FakeParam {
    value = 0;
    setValueAtTime() {}
    linearRampToValueAtTime() {}
  }
  class FakeGain {
    gain = new FakeParam();
    connect() {}
    disconnect() {}
  }
  class FakeOscillator {
    frequency = new FakeParam();
    onended = null;
    connect() {}
    disconnect() {}
    start() {}
    stop(when = 0) {
      setTimeout(() => this.onended?.(), Math.max(0, when * 1000));
    }
  }
  class FakeAudioContext {
    state = "running";
    currentTime = 0;
    destination = {};
    baseLatency = 0;
    outputLatency = 0;
    createOscillator() {
      return new FakeOscillator();
    }
    createGain() {
      return new FakeGain();
    }
    async resume() {
      this.state = "running";
    }
    async suspend() {
      this.state = "suspended";
    }
    async close() {
      this.state = "closed";
    }
  }
  Object.defineProperty(window, "AudioContext", {
    configurable: true,
    writable: true,
    value: FakeAudioContext,
  });
});

async function readCheckpoint() {
  return page.evaluate(async (name) => {
    if (!(await indexedDB.databases()).some((db) => db.name === name))
      return null;
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("meta", "readonly");
        const request = tx.objectStore("meta").getAll();
        request.onsuccess = () =>
          resolve(
            request.result.find((row) => row.value?.kind === "guided")?.value ??
              null,
          );
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, EVIDENCE_DB);
}

async function history() {
  return page.evaluate(async () => {
    const token = localStorage.getItem("access_token");
    const response = await fetch(
      "/v1/training/sessions?mode=guided&status=all&limit=100",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    return { status: response.status, body: await response.json() };
  });
}

try {
  await page.goto(`${baseURL}/en/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Username or Email").fill(accounts.A.username);
  await page.getByLabel("Password", { exact: true }).fill(accounts.A.password);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await page.waitForURL(`${baseURL}/en`, { timeout: 15_000 });

  const before = await history();
  assert.equal(before.status, 200);
  const beforeIds = new Set(
    before.body.sessions.map((session) => session.session_id),
  );

  await page.goto(`${baseURL}/en/morse/learn/session?step=1`, {
    waitUntil: "networkidle",
  });
  let checkpoint = null;
  for (let attempt = 0; attempt < 75; attempt += 1) {
    checkpoint = await readCheckpoint();
    if (checkpoint) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(checkpoint, "guided checkpoint was created");
  const prompts = checkpoint.state.prompts;
  assert.ok(prompts.length > 0);
  console.log(`guided prompt plan: ${prompts.length} prompts`);
  const sessionId = checkpoint.id;

  for (const [index, prompt] of prompts.entries()) {
    const { kind, expectedText: expected } = prompt.spec;
    if (kind === "introduction") {
      const listen = page.getByRole("button", {
        name: `Listen to ${expected}`,
      });
      if (await listen.isVisible().catch(() => false)) await listen.click();
      const proceed = page.getByRole("button", { name: "Continue" });
      await proceed.waitFor({ timeout: 10_000 });
      await proceed.click();
    } else {
      const play = page.getByRole("button", { name: "Play sound" });
      if (await play.isVisible().catch(() => false)) await play.click();
      if (kind === "recall" || kind === "short-group") {
        const input = page.getByRole("textbox", { name: "Type your answer" });
        await input.waitFor({ state: "visible", timeout: 10_000 });
        await input.fill(expected);
      } else {
        const option = page.getByRole("button", {
          name: `Select ${expected}`,
          exact: true,
        });
        await option.waitFor({ state: "visible", timeout: 10_000 });
        await option.click();
      }
      const proceed = page.getByRole("button", { name: "Continue" });
      await proceed.waitFor({ timeout: 10_000 });
      await proceed.click();
    }

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const next = await readCheckpoint();
      if (!next || next.state.currentPromptIndex > index) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (attempt === 49)
        throw new Error(`stalled at guided prompt ${index + 1}`);
    }
  }

  await page
    .getByRole("region", { name: "Session results" })
    .waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Finish for today" }).click();
  await page.waitForURL(`${baseURL}/en/morse/learn`, { timeout: 15_000 });

  let saved = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await history();
    assert.equal(result.status, 200);
    saved = result.body.sessions.find(
      (session) => session.session_id === sessionId,
    );
    if (saved && !beforeIds.has(sessionId)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(saved, "completed guided session reached the server");
  assert.equal(saved.status, "completed");
  assert.equal(saved.mode, "guided");
  assert.deepEqual(pageErrors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        prompts: prompts.length,
        sessionId,
        serverStatus: saved.status,
        accuracy: saved.accuracy,
        pageErrors,
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
  await browser.close();
}
