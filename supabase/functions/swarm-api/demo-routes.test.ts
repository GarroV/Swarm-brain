// Белый список демо (demo-routes.ts): что открыто, что закрыто, и что он стоит в index.ts до
// маршрутов. Плюс сверка с вебом: каждый адрес, который зовёт miniapp, либо открыт демо, либо
// явно записан ниже как закрытый — новый экран не сломает витрину молча.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";
import { demoGate, demoRouteAllowed } from "./demo-routes.ts";

const ID = "3f1c2b9e-1111-4222-8333-944455556666";

const ALLOWED: Array<[string, string]> = [
  ["GET", "/me"],
  ["PATCH", "/me"],
  ["GET", "/config"],
  ["POST", "/auth/revoke-sessions"],
  ["GET", "/integrations"],
  ["GET", "/recorder/setup"],
  ["GET", "/mcp/setup"],
  ["GET", "/me/passkeys"],
  ["GET", "/tasks"],
  ["POST", "/tasks"],
  ["PATCH", `/tasks/${ID}`],
  ["GET", "/tasks/archived"],
  ["POST", `/tasks/${ID}/comments`],
  ["GET", `/tasks/${ID}/files/${ID}/url`],
  ["GET", "/projects"],
  ["POST", `/projects/${ID}/dissolve`],
  ["GET", "/sprint-cycles/board"],
  ["PATCH", `/sprint-tasks/${ID}/span`],
  ["GET", `/spaces/demo/journal`],
  ["GET", "/entries"],
  ["GET", `/meetings/${ID}`],
  ["PATCH", `/meetings/${ID}`],
  ["GET", "/meetings/facets"],
  ["GET", "/meetings/record/active"],
  ["GET", `/agent-meetings/${ID}`],
  ["GET", "/search"],
  ["POST", "/ask"],
  ["GET", "/demo/questions"],
  ["GET", "/stickers"],
  ["GET", "/quality/maps"],
  ["GET", "/market/countries"],
  ["GET", "/notifications"],
  ["GET", "/presence/strip"],
];

const DENIED: Array<[string, string]> = [
  ["POST", "/mcp/token"],
  ["POST", "/recorder/token"],
  ["GET", "/mcp/desktop/setup"],
  ["POST", "/mcp/desktop/token"],
  ["GET", "/mcp/oauth/authorize"],
  ["POST", "/mcp/oauth/authorize"],
  ["GET", "/mcp/connections"],
  ["DELETE", `/mcp/connections/${ID}`],
  ["POST", "/me/passkeys/device-link"],
  ["DELETE", `/me/passkeys/${ID}`],
  ["POST", "/telegram/link"],
  ["GET", "/google/connect-url"],
  ["DELETE", "/integrations/google"],
  ["POST", "/integrations/granola"],
  ["POST", `/granola/notes/${ID}/skip`],
  ["PUT", "/scriba/autojoin"],
  ["POST", "/tasks/voice"],
  ["GET", "/board/today"],
  ["PUT", "/board/call"],
  ["POST", "/meeting-invites"],
  ["GET", `/meeting-invites/${ID}`],
  ["POST", "/meetings/record"],
  ["POST", `/meetings/record/${ID}/finish`],
  ["GET", "/admin/workspaces"],
  ["GET", "/admin/review-counts"],
  ["GET", "/admin/model-usage"],
  ["POST", "/admin/broadcast"],
  ["PUT", "/me/passkeys"],
  ["POST", "/spaces/demo/journal"],
  ["GET", "/something-new"],
  ["GET", "/tasksx"],
  ["GET", "/meetingsx"],
];

Deno.test("демо открыт показ продукта", () => {
  const closed = ALLOWED.filter(([m, p]) => !demoRouteAllowed(m, p));
  assertEquals(closed, [], "эти маршруты витрине нужны");
});

Deno.test("демо закрыто всё вне списка: ключи, подключения, админка, рекордер, новое", () => {
  const open = DENIED.filter(([m, p]) => demoRouteAllowed(m, p));
  assertEquals(open, [], "эти маршруты демо открываться не должны");
});

Deno.test("demoGate: вне списка — 403 demo_not_allowed, в списке — дальше", async () => {
  // Немодельные маршруты базу не трогают: пустой клиент достаточен.
  const ctx = { supabase: {} as never, origin: "" };
  const denied = await demoGate(ctx, new Request("http://x/mcp/token", { method: "POST" }), "/mcp/token");
  assertEquals(denied?.status, 403);
  assertEquals((await denied!.json()).code, "demo_not_allowed");
  assertEquals(await demoGate(ctx, new Request("http://x/tasks"), "/tasks"), null);
});

// ── Подключение в index.ts ─────────────────────────────────────────────────────

const HERE = fromFileUrl(new URL(".", import.meta.url));

Deno.test("index.ts: белый список демо стоит до первого обычного маршрута", async () => {
  const src = await Deno.readTextFile(HERE + "index.ts");
  const gate = src.search(/if \(isDemo\) \{\s*const demoResp = await demoGate\(/);
  assert(gate > 0, "в index.ts нет входа demoGate для демо-сессии");
  for (
    const first of [
      'routePath === "/auth/revoke-sessions"',
      "handleOAuthAccountRoute(",
      "handleAdminRoutes(",
      'routePath === "/me"',
    ]
  ) {
    const at = src.indexOf(first);
    assert(at > 0, `не нашёл в index.ts: ${first}`);
    assert(gate < at, `проверка демо стоит после ${first}`);
  }
});

// ── Сверка с вебом ─────────────────────────────────────────────────────────────

/** Адреса из веба, закрытые для демо намеренно (экран в демо их не зовёт или ждёт отказа). */
const DENIED_IN_WEB = new Set([
  "/admin/*",
  "/auth/logout", // обрабатывает Cloudflare Pages Function, до swarm-api не доходит
  "/google/connect-url",
  "/granola/notes/x/import",
  "/granola/notes/x/preview",
  "/granola/notes/x/skip",
  "/integrations/google",
  "/integrations/granola",
  "/mcp/token",
  "/me/passkeys/device-link",
  "/me/passkeys/x",
  "/meeting-invites",
  "/meeting-invites/x",
  "/meetings/record",
  "/meetings/record/x/finish",
  "/meetings/record/x/segments/x",
  "/recorder/token",
  "/scriba/autojoin",
  "/telegram/link",
]);

const WEB_SRC = fromFileUrl(new URL("../../../miniapp/src/", import.meta.url));
const CALL = /(?:apiFetch[A-Za-z]*(?:<[^>(]*>)?\(\s*[`"]|API_BASE\})(\/[^`"?]*)/g;

async function* webSources(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const p = `${dir}${e.name}`;
    if (e.isDirectory) yield* webSources(`${p}/`);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) yield p;
  }
}

/** `/tasks/${id}/files` → `/tasks/x/files`; хвост с незакрытой подстановкой отрезается. */
function normalize(raw: string): string {
  // `${…}` сразу после сегмента (`/tasks${qs}`) — строка запроса, не часть пути.
  const cut = raw.replace(/(?<=[^/])\$\{[^}]*\}/g, "").replace(/\$\{[^}]*\}/g, "x").replace(/\$\{.*$/, "");
  return cut.length > 1 ? cut.replace(/\/$/, "") : cut;
}

Deno.test("каждый адрес веба либо открыт демо, либо явно закрыт", async () => {
  const paths = new Set<string>();
  for await (const f of webSources(WEB_SRC)) {
    for (const m of (await Deno.readTextFile(f)).matchAll(CALL)) paths.add(normalize(m[1]));
  }
  // Пустой улов = проверка ничего не проверила.
  assert(paths.size > 60, `из веба собрано адресов: ${paths.size}`);
  const unclassified: string[] = [];
  const stale = new Set(DENIED_IN_WEB);
  for (const p of [...paths].sort()) {
    const key = p.startsWith("/admin") ? "/admin/*" : p;
    if (DENIED_IN_WEB.has(key)) {
      stale.delete(key);
      continue;
    }
    const probe = p.replace(/\/x(?=\/|$)/g, `/${ID}`);
    const opened = ["GET", "POST", "PATCH", "PUT", "DELETE"].some((m) => demoRouteAllowed(m, probe));
    if (!opened) unclassified.push(p);
  }
  assertEquals(
    unclassified,
    [],
    "веб зовёт эти адреса: добавь в DEMO_ALLOWED_ROUTES (demo-routes.ts) или в DENIED_IN_WEB с причиной",
  );
  assertEquals([...stale], [], "этих адресов в вебе больше нет — убери из DENIED_IN_WEB");
});
