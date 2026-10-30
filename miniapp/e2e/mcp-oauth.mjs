// Browser verification of the synthetic remote stand. Uses Chrome for Testing, never personal Chrome.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BASE_URL, CHROME, connect, DESKTOP, PHONE, shutdown } from "./lib.mjs";

const base = new URL(BASE_URL).origin;
assert(
  ["localhost", "127.0.0.1"].includes(new URL(base).hostname),
  "Use private stand tunnel",
);
assert(CHROME.includes("Testing"), "Chrome for Testing is required");
assert.equal(
  (await fetch(`${base}/health`).then((r) => r.json())).stand,
  "swarm-mcp-chatgpt",
);
const output = process.env.MCP_QA_OUTPUT;
assert(output, "Set MCP_QA_OUTPUT to a directory outside the repository");
await mkdir(output, { recursive: true });

const callback = "https://chatgpt.com/connector/oauth/swarm-browser-check";
const registered = await fetch(`${base}/oauth/register`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_name: "ChatGPT browser check",
    redirect_uris: [callback],
  }),
}).then((r) => r.json());
assert(registered.client_id);
const verifier = randomBytes(32).toString("base64url");
const params = new URLSearchParams({
  client_id: registered.client_id,
  response_type: "code",
  redirect_uri: callback,
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method: "S256",
  scope: "mcp offline_access",
  resource: `${base}/functions/v1/swarm-mcp`,
  state: "browser-check",
});
const authorization = await fetch(`${base}/oauth/authorize?${params}`, {
  redirect: "manual",
});
assert.equal(authorization.status, 302);
const consentUrl = authorization.headers.get("Location");
await authorization.body?.cancel();
let callbackUrl = null;
try {
  const { page, errors } = await connect(DESKTOP);
  const failedResponses = [];
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
    }
  });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url().startsWith(callback)) {
      callbackUrl = request.url();
      void request.respond({
        status: 200,
        contentType: "text/plain",
        body: "Synthetic callback captured by browser test",
      });
    } else if (new URL(request.url()).origin === "https://chatgpt.com") {
      // The synthetic callback document can request a favicon; keep it inside this test too.
      void request.respond({ status: 204 });
    } else void request.continue();
  });
  await page.goto(
    `${base}/api/auth/login?next=${encodeURIComponent("/?view=settings")}`,
    { waitUntil: "networkidle2" },
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some((el) =>
      el.textContent.includes("ChatGPT")
    )
  );
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((el) =>
      el.textContent.includes("ChatGPT")
    ).click()
  );
  await page.waitForFunction(() => document.body.innerText.includes("OAuth"));
  await page.waitForFunction(() =>
    document.querySelector("#chatgpt-mcp-address")?.value.includes(
      "/functions/v1/swarm-mcp",
    )
  );
  await page.screenshot({
    path: join(output, "chatgpt-desktop.png"),
    fullPage: true,
  });
  await page.setViewport(PHONE);
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some((el) =>
      el.textContent.includes("ChatGPT")
    )
  );
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((el) =>
      el.textContent.includes("ChatGPT")
    ).click()
  );
  await page.waitForFunction(() =>
    document.querySelector("#chatgpt-mcp-address")
  );
  await page.screenshot({
    path: join(output, "chatgpt-mobile.png"),
    fullPage: true,
  });
  assert(
    await page.evaluate(() =>
      document.documentElement.scrollWidth <= globalThis.innerWidth
    ),
    "Mobile must not overflow",
  );
  console.log("PASS personal ChatGPT settings: desktop + mobile");

  await page.goto(consentUrl, { waitUntil: "networkidle2" });
  await page.waitForFunction(() =>
    document.body.innerText.includes("ChatGPT browser check")
  );
  assert(
    await page.evaluate(() =>
      document.body.innerText.includes("Разрешить доступ")
    ),
    "Consent language must match the signed-in app",
  );
  await page.screenshot({
    path: join(output, "consent-mobile.png"),
    fullPage: true,
  });
  await page.setViewport(DESKTOP);
  await page.emulateMediaFeatures([{
    name: "prefers-color-scheme",
    value: "dark",
  }]);
  // Mobile emulation changes may reload the page: wait for consent to mount again.
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some((el) =>
      /Разрешить доступ|Allow access/.test(el.textContent)
    )
  );
  await page.screenshot({
    path: join(output, "consent-desktop-dark.png"),
    fullPage: true,
  });
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((el) =>
      /Разрешить доступ|Allow access/.test(el.textContent)
    ).click()
  );
  await page.waitForFunction(() =>
    document.body.innerText.includes("Synthetic callback captured")
  );
  assert.equal(new URL(callbackUrl).searchParams.get("state"), "browser-check");
  assert(new URL(callbackUrl).searchParams.has("code"));
  console.log(
    "PASS real consent UI + safe callback (no request sent to ChatGPT)",
  );
  // Test pending access and revoke through the same controls the employee sees.
  await page.goto(`${base}/?view=settings`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some((el) =>
      el.textContent.includes("ChatGPT")
    )
  );
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((el) =>
      el.textContent.includes("ChatGPT")
    ).click()
  );
  await page.waitForFunction(() =>
    document.body.innerText.includes("ChatGPT browser check")
  );
  assert(
    await page.evaluate(() =>
      /Ожидает первого обращения|Awaiting first request/.test(
        document.body.innerText,
      )
    ),
  );
  const disconnect = await page.$$("button");
  for (const button of disconnect) {
    if (
      /^(Отключить|Disconnect)$/.test(
        (await button.evaluate((el) => el.textContent)).trim(),
      )
    ) {
      await button.click();
      break;
    }
  }
  await page.waitForSelector('[role="dialog"], [role="alertdialog"]');
  await page.evaluate(() =>
    [...document.querySelectorAll(
      '[role="dialog"] button, [role="alertdialog"] button',
    )].find((el) => /^(Отключить|Disconnect)$/.test(el.textContent.trim()))
      .click()
  );
  await page.waitForFunction(() =>
    !document.body.innerText.includes("ChatGPT browser check")
  );
  console.log("PASS pending status + personal disconnect UI");
  if (errors.length) console.log("HTTP failure context:", failedResponses);
  assert.deepEqual(errors, [], "Browser console/page errors");
} finally {
  await shutdown();
}
