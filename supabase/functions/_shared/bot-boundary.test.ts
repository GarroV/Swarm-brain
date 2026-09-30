// Граница бот ↔ ядро (D029, T177): бот донастраивается без правки основного кода Swarm.
//
// Тест структурный, по образцу auth-doors.test.ts: поведенческий тест такую правку не поймает —
// имя бота, вписанное в ядро, или импорт модуля автозапуска из meeting-claim работают ровно так
// же, как до правки. Ломается другое: следующая донастройка бота снова требует правки ядра.
//
// Ядро — весь рабочий код supabase/functions, кроме модулей бота (список ниже). В ядре:
//   1. нет литерала `scriba` (ни в коде, ни в комментариях) — имя живёт в профиле бота;
//   2. из модулей бота импортируются только профиль и его тексты (плюс явные точки монтирования).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = decodeURIComponent(new URL("../", import.meta.url).pathname);

/**
 * Модули бота на сервере. Каталог — вся функция целиком. Новый модуль бота вписывается сюда;
 * модуль ядра сюда не вписывается никогда — иначе граница снимается одной строкой.
 */
const BOT_MODULES = [
  "_shared/bot-profile.ts",
  "_shared/bot-notice-texts.ts",
  // Автозапуск по календарю (D021): окно, пропуски, снимок дня.
  "_shared/calendar-dispatch.ts",
  "_shared/calendar-missed.ts",
  "_shared/calendar-miss-store.ts",
  "_shared/calendar-snapshot.ts",
  "swarm-api/autojoin.ts",
  "meeting-calendar/",
  "meeting-calendar-snapshot/",
  "meeting-missed/",
  // Оркестратор забирает приглашения (D017).
  "meeting-invite/",
];

/** Что ядру можно брать у бота: профиль и тексты его уведомлений. */
const CORE_MAY_IMPORT = [
  "_shared/bot-profile.ts",
  "_shared/bot-notice-texts.ts",
];

/**
 * Точки монтирования: файл ядра, который только подключает маршрут бота, не зная, что в нём.
 * Веб-API отдаёт переключатель автозапуска со своего адреса — ручка целиком в autojoin.ts.
 */
const MOUNTS: Record<string, string[]> = {
  "swarm-api/index.ts": ["swarm-api/autojoin.ts"],
};

/** Имя бота. `transcribator` в названиях дизайн-доков — не оно. */
const BOT_NAME = /(?<![a-z])scriba/i;

function isBotModule(path: string): boolean {
  return BOT_MODULES.some((
    m,
  ) => (m.endsWith("/") ? path.startsWith(m) : path === m));
}

async function listCode(dir = ""): Promise<string[]> {
  const out: string[] = [];
  for await (const entry of Deno.readDir(`${ROOT}${dir}`)) {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory) out.push(...await listCode(`${path}/`));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(path);
    }
  }
  return out.sort();
}

/** Относительные импорты файла (статические и динамические), приведённые к пути от ROOT. */
export function relativeImports(from: string, src: string): string[] {
  const specs = [
    ...src.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g),
  ].map((m) => m[1]);
  const base = from.split("/").slice(0, -1);
  return specs.map((spec) => {
    const parts = [...base];
    for (const seg of spec.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg !== ".") parts.push(seg);
    }
    return parts.join("/");
  });
}

/** Нарушения границы в одном файле ядра. Чистая функция — её же гоняет проверка на порче. */
export function violations(path: string, src: string): string[] {
  const found: string[] = [];
  const line = src.split("\n").findIndex((l) => BOT_NAME.test(l));
  if (line >= 0) {
    found.push(
      `${path}:${line + 1} — имя бота в ядре (берите BOT_PROFILE.name)`,
    );
  }
  const allowed = [...CORE_MAY_IMPORT, ...(MOUNTS[path] ?? [])];
  for (const target of relativeImports(path, src)) {
    if (isBotModule(target) && !allowed.includes(target)) {
      found.push(
        `${path} импортирует модуль бота ${target} — ядру доступны только ${allowed.join(", ")}`,
      );
    }
  }
  return found;
}

Deno.test("БЛОКИРУЮЩИЙ: ядро не знает имени бота и не импортирует его модули", async () => {
  const core = (await listCode()).filter((p) => !isBotModule(p));
  const found: string[] = [];
  for (const path of core) {
    found.push(...violations(path, await Deno.readTextFile(`${ROOT}${path}`)));
  }
  assertEquals(
    found,
    [],
    "граница бот ↔ ядро (docs/furca/bot-boundary.md): настройка бота — в _shared/bot-profile.ts, " +
      "его модуль — в списке BOT_MODULES",
  );
});

// Сам тест не должен проходить потому, что ничего не нашёл: обход обязан видеть ядро,
// а разбор импортов — реальную точку монтирования.
Deno.test("граница: обход видит ядро, разбор импортов видит монтирование маршрута бота", async () => {
  const all = await listCode();
  const core = all.filter((p) => !isBotModule(p));
  for (
    const must of [
      "meeting-claim/index.ts",
      "meeting-ingest/index.ts",
      "_shared/agent-auth.ts",
    ]
  ) {
    assert(core.includes(must), `${must} не попал в ядро — обход сломан`);
  }
  for (const m of BOT_MODULES) {
    assert(
      all.some((p) => (m.endsWith("/") ? p.startsWith(m) : p === m)),
      `модуля бота ${m} нет на диске`,
    );
  }
  const index = await Deno.readTextFile(`${ROOT}swarm-api/index.ts`);
  assert(
    relativeImports("swarm-api/index.ts", index).includes(
      "swarm-api/autojoin.ts",
    ),
    "импорт не разобран",
  );
});

Deno.test("граница: проверка краснеет на имени бота и на чужом импорте", () => {
  assertEquals(violations("meeting-claim/x.ts", "// бот scriba\n").length, 1);
  assertEquals(
    violations("meeting-claim/x.ts", 'const c = "SCRIBA_MAX";').length,
    1,
  );
  assertEquals(
    violations("meeting-claim/x.ts", "// transcribator/10-REVISED-DESIGN.md")
      .length,
    0,
  );
  assertEquals(
    violations(
      "meeting-claim/x.ts",
      'import { planPersonDispatch } from "../_shared/calendar-dispatch.ts";',
    ).length,
    1,
  );
  assertEquals(
    violations(
      "_shared/x.ts",
      'import { BOT_PROFILE } from "./bot-profile.ts";',
    ).length,
    0,
  );
  // Строка импорта собирается по частям: иначе граф модулей scripts/check-graph.ts принял бы
  // пример порчи за настоящий импорт роута из _shared.
  const routeImport = ["import { h } from ", '"../swarm-api/autojoin.ts";']
    .join("");
  assertEquals(violations("meeting-ingest/x.ts", routeImport).length, 1);
});
