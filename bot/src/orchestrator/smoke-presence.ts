/**
 * Real Chromium + actual adapters; all meeting pages are local fixtures, no live calls.
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import { KonturAdapter } from "../kontur-adapter/kontur.ts";
import { MeetAdapter, meetLaunchOptions } from "../meet-adapter/meet.ts";

function latest(lines: readonly string[]): { state: string; rosterComplete: boolean } {
  const line = lines.findLast((item) => item.startsWith("presence "));
  assert.ok(line, "actual adapter must emit presence evidence");
  return JSON.parse(line.slice("presence ".length)) as { state: string; rosterComplete: boolean };
}

async function kontur(browser: Browser): Promise<void> {
  const lines: string[] = [];
  const adapter = new KonturAdapter({
    browser,
    guestRoom: { waitMs: 2000, reloadMs: 500 },
    log: (line) => {
      lines.push(line);
    },
    prepareContext: async (context) => {
      await context.route("https://example.ktalk.ru/**", async (route) =>
        route.fulfill({
          path: fileURLToPath(new URL("../kontur-adapter/fixtures/room.html", import.meta.url)),
          contentType: "text/html; charset=utf-8",
        }),
      );
    },
  });
  try {
    await adapter.join("https://example.ktalk.ru/presence?scene=open", "Scriba Notetaker");
    assert.equal(await adapter.waitAdmitted(5000), "admitted");
    assert.equal(await adapter.aloneSignal(), false);
    assert.equal(latest(lines).state, "participants_visible");
    const page = browser.contexts().at(-1)?.pages()[0];
    assert.ok(page);
    await page.evaluate(`document.querySelectorAll('.participant-info-content')[1].textContent='Read.ai';
      document.querySelectorAll('conference-participant').forEach(x=>x.classList.remove('active-speaker'))`);
    assert.equal(
      await adapter.aloneSignal(),
      false,
      "diagnostics must not change call termination",
    );
    assert.equal(latest(lines).state, "only_self_or_recorder_names");
    await page.evaluate(`document.querySelector('conference-participants-area').remove();
      document.querySelector('[aria-label="Участники"]').remove()`);
    assert.equal(await adapter.aloneSignal(), null);
    assert.equal(latest(lines).state, "unknown");
    console.log(
      "PASS kontur: real DOM roster, recorder names, unavailable signal; exit policy unchanged",
    );
  } finally {
    await adapter.leave();
  }
}

async function meet(browser: Browser): Promise<void> {
  const lines: string[] = [];
  const adapter = new MeetAdapter({
    browser,
    log: (line) => {
      lines.push(line);
    },
    prepareContext: async (context) => {
      await context.route("https://meet.google.com/**", async (route) =>
        route.fulfill({
          path: fileURLToPath(
            new URL("../meet-adapter/fixtures/in-call-speaking.html", import.meta.url),
          ),
          contentType: "text/html; charset=utf-8",
        }),
      );
    },
  });
  try {
    await adapter.join("https://meet.google.com/abc-defg-hij", "Scriba Notetaker");
    assert.equal(await adapter.waitAdmitted(5000), "admitted");
    assert.equal(await adapter.aloneSignal(), false);
    assert.equal(latest(lines).state, "participants_visible");
    const page = browser.contexts().at(-1)?.pages()[0];
    assert.ok(page);
    await page.evaluate(
      "document.querySelectorAll('[data-participant-id]').forEach(x=>x.remove());document.querySelectorAll('[role=list]').forEach(x=>x.remove())",
    );
    assert.equal(await adapter.aloneSignal(), null);
    assert.equal(latest(lines).state, "unknown");
    console.log("PASS meet: real DOM participants, unavailable signal");
  } finally {
    await adapter.leave();
  }
}

const browser = await chromium.launch({ ...meetLaunchOptions(), headless: true });
try {
  await kontur(browser);
  await meet(browser);
  assert.equal(browser.contexts().length, 0);
  console.log("PASS: browser contexts closed; live calls 0");
} finally {
  await browser.close();
}
