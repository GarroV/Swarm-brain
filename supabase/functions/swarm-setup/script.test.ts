import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { SETUP_SCRIPT, MERGE_FUNCTION, BRIDGE_SCRIPT } from "./script.ts";

// Тесты установщика Claude Desktop. Скрипт правит ЧУЖОЙ файл конфигурации пользователя, где уже
// могут жить другие MCP-серверы, и рапортует об успехе — здесь закрыты три класса:
//   1) мёрж — прогоняется НАСТОЯЩАЯ функция merge_config из script.ts (импортом, не копией:
//      копия разошлась бы с оригиналом и тест бы врал);
//   2) состав проверок — чтобы пробу токена нельзя было тихо удалить (issue #47: без неё
//      установщик печатал «✅ Готово», а в Claude было «Server disconnected»);
//   3) отсутствие Node — схема переведена на мост bash+curl (issue #47, 2026-08-25), и возврат
//      npx/mcp-remote в конфиг должен ронять тест, а не всплывать у пользователя за VPN.

const SRV_JSON = JSON.stringify({
  command: "/bin/bash",
  args: ["/Users/x/.swarm-brain/bin/swarm-mcp-bridge.sh"],
  env: { SWARM_MCP_URL: "https://example.test/functions/v1/swarm-mcp", SWARM_MCP_AUTH: "Bearer smcp_test123" },
});

// JSON-движок мёржа — `plutil`, утилита macOS: на ней и валидация, и -insert/-replace/-extract.
// Установщик по определению macOS-only (правит ~/Library/Application Support/Claude), поэтому
// переносимым его делать незачем — а вот тесты, прогоняющие НАСТОЯЩИЙ мёрж, на Linux запускать
// нельзя: без plutil функция честно возвращает 3 («не могу проверить — не трогаю чужой файл»),
// и пять тестов падали в CI, оставляя main красным с 25.08 (issue #106). Такой красный CI хуже
// отсутствующего: он обесценивал проверки на ВСЕХ PR — свою поломку от чужой было не отличить.
// Теперь эти тесты помечены пропуском там, где plutil нет, а инварианты, которые они охраняют,
// продублированы статическими проверками ниже — те гоняются на любой платформе.
const HAS_PLUTIL = await (async () => {
  try {
    const { code } = await new Deno.Command("plutil", { args: ["-help"], stdout: "null", stderr: "null" }).output();
    return code === 0 || code === 1; // -help на разных версиях отдаёт и 0, и 1 — важно лишь, что бинарь есть
  } catch {
    return false;
  }
})();
if (!HAS_PLUTIL) {
  console.log("ℹ️  plutil недоступен (не macOS) — тесты настоящего мёржа пропущены, идут статические проверки");
}
const macOnly = (name: string, fn: () => Promise<void> | void) =>
  Deno.test({ name: `${name} [macOS]`, ignore: !HAS_PLUTIL, fn });

// Прогон настоящей merge_config на подготовленном конфиге. Возвращает код возврата и текст файла.
async function runMerge(existing: string | null): Promise<{ code: number; raw: string }> {
  const dir = await Deno.makeTempDir();
  const cfgPath = `${dir}/claude_desktop_config.json`;
  if (existing !== null) await Deno.writeTextFile(cfgPath, existing);
  const script = `${MERGE_FUNCTION}\nmerge_config "$1" "$2"\n`;
  const cmd = new Deno.Command("bash", { args: ["-c", script, "bash", cfgPath, SRV_JSON], stdout: "piped", stderr: "piped" });
  const { code } = await cmd.output();
  const raw = await Deno.readTextFile(cfgPath).catch(() => "");
  await Deno.remove(dir, { recursive: true });
  return { code, raw };
}

async function mergeJson(existing: string | null): Promise<Record<string, any>> {
  const { code, raw } = await runMerge(existing);
  assertEquals(code, 0);
  return JSON.parse(raw);
}

macOnly("мёрж: на чистой машине создаёт swarm-brain со stdio-формой", async () => {
  const cfg = await mergeJson(null);
  const s = cfg.mcpServers["swarm-brain"];
  assertEquals(s.command, "/bin/bash");
  assertEquals(s.args[0].endsWith("swarm-mcp-bridge.sh"), true);
  // "url"/"type" Claude Desktop не понимает и молча затирает весь mcpServers — их быть не должно.
  assertEquals("url" in s, false);
  assertEquals("type" in s, false);
  assertEquals(s.env.SWARM_MCP_AUTH, "Bearer smcp_test123");
});

macOnly("мёрж: ЧУЖИЕ серверы и настройки остаются нетронутыми", async () => {
  const cfg = await mergeJson(JSON.stringify({
    mcpServers: {
      knowledgebase: { command: "/usr/bin/foo", args: ["a"] },
      figma: { command: "/usr/bin/node", args: ["x", "figma-mcp"] },
    },
    theme: "dark",
  }));
  assertEquals(Object.keys(cfg.mcpServers).sort(), ["figma", "knowledgebase", "swarm-brain"]);
  assertEquals(cfg.mcpServers.knowledgebase.command, "/usr/bin/foo");
  assertEquals(cfg.mcpServers.figma.args[1], "figma-mcp");
  assertEquals(cfg.theme, "dark");
});

macOnly("мёрж: переустановка поверх старой Node-схемы заменяет блок целиком", async () => {
  const cfg = await mergeJson(JSON.stringify({
    mcpServers: {
      "swarm-brain": { command: "/old/node", args: ["npx", "-y", "mcp-remote"], env: { AUTH_HEADER: "Bearer old" } },
    },
  }));
  assertEquals(Object.keys(cfg.mcpServers), ["swarm-brain"]);
  assertEquals(cfg.mcpServers["swarm-brain"].command, "/bin/bash");
  // Старый ключ env не должен пережить замену — иначе в конфиге останется мёртвый токен.
  assertEquals("AUTH_HEADER" in cfg.mcpServers["swarm-brain"].env, false);
});

macOnly("мёрж: пустой файл и конфиг без mcpServers не роняют установку", async () => {
  assertEquals(typeof (await mergeJson("")).mcpServers, "object");
  const cfg = await mergeJson(JSON.stringify({ theme: "dark" }));
  assertEquals(cfg.theme, "dark");
  assertEquals("swarm-brain" in cfg.mcpServers, true);
});

macOnly("мёрж: битый JSON НЕ затирается — код возврата 3, файл пользователя цел", async () => {
  const broken = '{"mcpServers": {"knowledgebase": ';
  const { code, raw } = await runMerge(broken);
  assertEquals(code, 3);
  assertEquals(raw, broken);
});

macOnly("мёрж: валидный JSON не принимается за битый", async () => {
  // Регресс-тест: проверка валидности через plutil -lint ругалась «Unexpected character {» на
  // ЛЮБОЙ корректный JSON (lint ждёт property list), и установщик отказывался ставиться на
  // нормальный конфиг. Проверка должна быть через plutil -convert.
  const { code } = await runMerge(JSON.stringify({ mcpServers: { figma: { command: "/usr/bin/figma" } } }));
  assertEquals(code, 0);
});

// Исполняемая часть bash-функции: без строк-комментариев. Нужна, потому что сам запрет `-lint`
// объяснён комментарием ВНУТРИ функции — проверка по всему тексту ловила бы это объяснение
// (поймано на себе: первый вариант теста упал именно так).
const MERGE_CODE = MERGE_FUNCTION.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

Deno.test("статика мёржа: валидность проверяется через -convert, а НЕ через -lint", () => {
  // Регресс issue #47: plutil -lint ждёт property list и ругается «Unexpected character {» на
  // ЛЮБОЙ валидный JSON — установщик объявлял нормальный конфиг битым и отказывался ставиться.
  assertStringIncludes(MERGE_CODE, "plutil -convert json -o /dev/null");
  assertEquals(MERGE_CODE.includes("plutil -lint"), false);
});

Deno.test("статика мёржа: битый конфиг не перезаписывается (есть выход с кодом 3)", () => {
  assertStringIncludes(MERGE_FUNCTION, "return 3");
  // Замена именно точечная: плоский `plutil -replace mcpServers` снёс бы чужие серверы.
  assertStringIncludes(MERGE_FUNCTION, "plutil -replace 'mcpServers.swarm-brain'");
});

Deno.test("статика мёржа: успех подтверждается чтением записанного обратно", () => {
  // Иначе «✅ Готово» печаталось бы над несуществующей записью (issue #47).
  assertStringIncludes(MERGE_FUNCTION, "plutil -extract 'mcpServers.swarm-brain.command'");
});

Deno.test("статика мёржа: ключ mcpServers создаётся, а не затирается целиком", () => {
  assertStringIncludes(MERGE_FUNCTION, "plutil -insert mcpServers -json '{}'");
});

Deno.test("токен проверяется на сервере ДО записи конфига", () => {
  const probeAt = SETUP_SCRIPT.indexOf("Проверяю токен на сервере");
  const writeAt = SETUP_SCRIPT.indexOf("merge_config \"$CONFIG\"");
  assertEquals(probeAt > 0 && writeAt > probeAt, true);
});

Deno.test("Node в схему не вернулся: ни npx, ни mcp-remote, ни скачивания nodejs.org", () => {
  // Смотрим ИСПОЛНЯЕМЫЕ строки: в комментариях эти слова законны — они объясняют, что заменили.
  const code = SETUP_SCRIPT.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  for (const forbidden of ["mcp-remote", "npx", "nodejs.org", "registry.npmjs.org", "node_modules"]) {
    assertEquals(code.includes(forbidden), false, `в установщике снова ${forbidden}`);
  }
});

Deno.test("мост: шлёт токен заголовком и не отвечает на уведомления", () => {
  assertStringIncludes(BRIDGE_SCRIPT, "Authorization: $AUTH");
  assertStringIncludes(BRIDGE_SCRIPT, "want_reply");
  // Токен не должен попадать в аргументы процесса — иначе он виден в ps любому на машине.
  assertEquals(BRIDGE_SCRIPT.includes("smcp_"), false);
});
