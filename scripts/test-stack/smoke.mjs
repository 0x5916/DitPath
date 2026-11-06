#!/usr/bin/env node
/**
 * Cross-browser smoke checks against the running, real full-stack environment.
 * This complements the mock-API Playwright suite; it does not replace manual
 * audio or native-device acceptance.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(
  path.resolve(
    fileURLToPath(new URL("../../frontend/package.json", import.meta.url)),
  ),
);
const { chromium, firefox, webkit } = require("@playwright/test");

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
const browsers = { chromium, firefox, webkit };
const failures = [];
const evidence = [];

async function checkBrowser(name, launcher, { audio = false } = {}) {
  const browser = await launcher.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  try {
    const response = await page.goto(`${baseURL}/en`, {
      waitUntil: "networkidle",
    });
    assert.equal(response?.status(), 200, "home should return 200");
    await page.locator("#main-content").waitFor({ state: "visible" });

    const health = await page.evaluate(async () => {
      const response = await fetch("/v1/health");
      return { status: response.status, body: await response.json() };
    });
    assert.equal(health.status, 200, "same-origin API health");
    assert.equal(health.body.status, "healthy");

    await page.goto(`${baseURL}/en/login`, { waitUntil: "networkidle" });
    await page.getByLabel("Username or Email").fill(accounts.A.username);
    await page
      .getByLabel("Password", { exact: true })
      .fill(accounts.A.password);
    await page.getByRole("button", { name: "Login", exact: true }).click();
    await page.waitForURL(`${baseURL}/en`, { timeout: 15_000 });
    await page
      .getByRole("button", { name: accounts.A.username })
      .waitFor({ timeout: 10_000 });

    await page.goto(`${baseURL}/en/forum`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Forum", level: 1 }).waitFor();

    await page.goto(`${baseURL}/en/settings`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Settings", level: 1 }).waitFor();
    await page
      .getByRole("heading", { name: "Sound defaults", level: 2 })
      .waitFor();

    await page.goto(`${baseURL}/en/morse/learn`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Lessons", level: 1 }).waitFor();

    for (const [locale, lang] of [
      ["de", "de"],
      ["ja", "ja"],
      ["zh-Hans", "zh-Hans"],
      ["zh-Hant", "zh-Hant"],
    ]) {
      const localized = await page.goto(`${baseURL}/${locale}`, {
        waitUntil: "networkidle",
      });
      assert.equal(
        localized?.status(),
        200,
        `${locale} home should return 200`,
      );
      assert.equal(await page.locator("html").getAttribute("lang"), lang);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseURL}/en`, { waitUntil: "networkidle" });
    await page.locator(".bottom-nav").waitFor({ state: "visible" });

    // A production preview with the service worker is the only meaningful
    // offline check. Return online before other flows.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${baseURL}/en`, { waitUntil: "networkidle" });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload({ waitUntil: "networkidle" });
    await context.setOffline(true);
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });
      await page
        .locator("#main-content")
        .waitFor({ state: "visible", timeout: 15_000 });
    } finally {
      await context.setOffline(false);
    }

    if (audio) {
      const audioPage = await context.newPage();
      await audioPage.addInitScript(() => {
        const stats = { created: 0, closed: 0 };
        window.__ditpathAudioStats = stats;
        const Native = window.AudioContext;
        window.AudioContext = new Proxy(Native, {
          construct(target, innerArgs) {
            stats.created += 1;
            const context = Reflect.construct(target, innerArgs);
            const close = context.close.bind(context);
            context.close = () => {
              stats.closed += 1;
              return close();
            };
            return context;
          },
        });
      });
      const audioErrors = [];
      audioPage.on("pageerror", (error) => audioErrors.push(String(error)));
      await audioPage.goto(`${baseURL}/en/morse/practice`, {
        waitUntil: "networkidle",
      });
      await audioPage.getByRole("button", { name: "Start practice" }).click();
      await audioPage
        .getByRole("textbox", { name: "Your copy" })
        .waitFor({ timeout: 15_000 });
      await audioPage.waitForTimeout(500);
      await audioPage.keyboard.press("Escape");
      await audioPage
        .getByRole("button", { name: "Replay" })
        .waitFor({ timeout: 10_000 });
      await audioPage.getByRole("button", { name: "Replay" }).click();
      await audioPage.waitForTimeout(300);
      await audioPage.keyboard.press("Escape");
      const stats = await audioPage.evaluate(() => window.__ditpathAudioStats);
      assert.ok(
        stats.created > 0,
        "practice should create a real AudioContext",
      );
      await audioPage.close();
      assert.deepEqual(audioErrors, [], "audio page errors");
      evidence.push({
        browser: name,
        audioContextsCreated: stats.created,
        audioClosed: stats.closed,
      });
    }

    assert.deepEqual(pageErrors, [], `${name} page errors`);
    evidence.push({
      browser: name,
      home: 200,
      login: true,
      forum: true,
      settings: true,
      lessons: true,
      locales: 5,
      mobileNavigation: true,
      offlineReload: true,
      consoleErrors: [...new Set(consoleErrors)],
    });
    console.log(`${name}: PASS`);
  } catch (error) {
    failures.push(
      `${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(
      `${name}: FAIL — ${error instanceof Error ? error.message : error}`,
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

for (const [name, launcher] of Object.entries(browsers)) {
  await checkBrowser(name, launcher, { audio: name === "chromium" });
}

console.log(
  JSON.stringify(
    { baseURL, passed: failures.length === 0, failures, evidence },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
