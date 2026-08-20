import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { SETUP_SCRIPT } from "./script.ts";

// Тесты установщика Claude Desktop. Шапка script.ts давно обещала «тесты мёржа», но их не
// существовало — при том что скрипт правит ЧУЖОЙ файл конфигурации пользователя, где уже могут
// жить другие MCP-серверы, и рапортует об успехе. Здесь закрыты два класса:
//   1) мёрж — прогоняется НАСТОЯЩИЙ node-код из скрипта (вырезается из отрендеренного текста),
//      а не его копия: копия разошлась бы с оригиналом и тест бы врал;
//   2) состав проверок — чтобы проверку токена и подтяжку mcp-remote нельзя было тихо удалить
//      (issue #47: без них установщик печатал «✅ Готово», а в Claude было «Server disconnected»).

// ── Вырезаем из скрипта тот самый блок мёржа (node -e '…') ────────────────────
function mergeSource(): string {
  const m = SETUP_SCRIPT.match(/"\$NODE_BIN" -e '([\s\S]*?)'\n/);
  if (!m) throw new Error("блок мёржа не найден — изменилась форма вызова node -e");
  return m[1];
}

// Прогон блока мёржа на подготовленном конфиге; возвращает получившийся JSON.
async function runMerge(existing: string | null): Promise<Record<string, unknown>> {
  const dir = await Deno.makeTempDir();
  const cfgPath = `${dir}/claude_desktop_config.json`;
  if (existing !== null) await Deno.writeTextFile(cfgPath, existing);
  const cmd = new Deno.Command("node", {
    args: ["-e", mergeSource()],
    env: {
      CONFIG_PATH: cfgPath,
      NODE_BIN: "/opt/node/bin/node",
      NPX_PATH: "/opt/node/bin/npx",
      MCP_URL: "https://example.test/functions/v1/swarm-mcp",
      SWARM_TOKEN: "smcp_test123",
    },
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stderr } = await cmd.output();
  if (code !== 0) throw new Error(`merge exit ${code}: ${new TextDecoder().decode(stderr)}`);
  const out = JSON.parse(await Deno.readTextFile(cfgPath));
  await Deno.remove(dir, { recursive: true });
  return out;
}

Deno.test("мёрж: на чистой машине создаёт swarm-brain со stdio-формой", async () => {
  const cfg = await runMerge(null) as { mcpServers: Record<string, Record<string, unknown>> };
  const s = cfg.mcpServers["swarm-brain"];
  assertEquals(s.command, "/opt/node/bin/node");
  // Claude Desktop понимает в файле ТОЛЬКО stdio-форму: url/type:http он не читает и затирает
  // весь mcpServers. Если кто-то «упростит» конфиг до url — этот тест обязан упасть.
  assertEquals("url" in s, false);
  assertEquals("type" in s, false);
  assertEquals((s.env as Record<string, string>).AUTH_HEADER, "Bearer smcp_test123");
  // Литерал подставляется mcp-remote в рантайме — в args должен лежать именно он, не сам токен.
  assertStringIncludes(JSON.stringify(s.args), "Authorization:${AUTH_HEADER}");
  assertEquals(JSON.stringify(s.args).includes("smcp_test123"), false);
});

Deno.test("мёрж: ЧУЖИЕ серверы остаются нетронутыми", async () => {
  const before = JSON.stringify({
    mcpServers: {
      knowledgebase: { command: "/usr/bin/foo", args: ["--bar"] },
      figma: { command: "npx", args: ["-y", "figma-mcp"] },
    },
  });
  const cfg = await runMerge(before) as { mcpServers: Record<string, Record<string, unknown>> };
  assertEquals(Object.keys(cfg.mcpServers).sort(), ["figma", "knowledgebase", "swarm-brain"]);
  assertEquals(cfg.mcpServers.knowledgebase.command, "/usr/bin/foo");
  assertEquals((cfg.mcpServers.figma.args as string[])[1], "figma-mcp");
});

Deno.test("мёрж: повторная установка перезаписывает свой блок, не плодя дублей", async () => {
  const first = JSON.stringify({
    mcpServers: { "swarm-brain": { command: "/old/node", env: { AUTH_HEADER: "Bearer smcp_OLD" } } },
  });
  const cfg = await runMerge(first) as { mcpServers: Record<string, Record<string, unknown>> };
  assertEquals(Object.keys(cfg.mcpServers), ["swarm-brain"]);
  assertEquals(cfg.mcpServers["swarm-brain"].command, "/opt/node/bin/node");
  assertEquals((cfg.mcpServers["swarm-brain"].env as Record<string, string>).AUTH_HEADER, "Bearer smcp_test123");
});

Deno.test("мёрж: пустой файл и конфиг без mcpServers не роняют установку", async () => {
  assertEquals(typeof (await runMerge("")).mcpServers, "object");
  const cfg = await runMerge(JSON.stringify({ theme: "dark" })) as Record<string, unknown>;
  assertEquals(cfg.theme, "dark");                      // чужие настройки сохранены
  assertEquals("swarm-brain" in (cfg.mcpServers as Record<string, unknown>), true);
});

Deno.test("мёрж: битый JSON НЕ затирается — выход с кодом 3 (бэкап цел)", async () => {
  const dir = await Deno.makeTempDir();
  const cfgPath = `${dir}/claude_desktop_config.json`;
  const broken = "{ это не json ";
  await Deno.writeTextFile(cfgPath, broken);
  const { code } = await new Deno.Command("node", {
    args: ["-e", mergeSource()],
    env: {
      CONFIG_PATH: cfgPath, NODE_BIN: "/opt/node/bin/node", NPX_PATH: "/opt/node/bin/npx",
      MCP_URL: "https://example.test/mcp", SWARM_TOKEN: "smcp_test123",
    },
    stdout: "piped", stderr: "piped",
  }).output();
  assertEquals(code, 3);
  assertEquals(await Deno.readTextFile(cfgPath), broken);   // файл пользователя не тронут
  await Deno.remove(dir, { recursive: true });
});

// ── Состав проверок: их нельзя тихо удалить ───────────────────────────────────

Deno.test("токен проверяется на сервере ДО записи конфига", () => {
  const probeAt = SETUP_SCRIPT.indexOf("Проверяю токен на сервере");
  const writeAt = SETUP_SCRIPT.indexOf("Мёрж swarm-brain");
  assertEquals(probeAt > 0 && writeAt > probeAt, true);
  // Проверять надо tools/call: initialize и tools/list отвечают и без авторизации.
  assertStringIncludes(SETUP_SCRIPT, '"method":"tools/call"');
});

Deno.test("токен чистится от пробелов и переносов до отправки", () => {
  assertStringIncludes(SETUP_SCRIPT, "tr -d '[:space:]'");
});

Deno.test("mcp-remote подтягивается установщиком, а не при первом запуске в Claude", () => {
  assertStringIncludes(SETUP_SCRIPT, "install --no-save");
  assertStringIncludes(SETUP_SCRIPT, "mcp-remote");
});

Deno.test("определение версии Node не шумит ошибкой curl (56) из-за SIGPIPE", () => {
  const line = SETUP_SCRIPT.split("\n").find((l) => l.includes("nodejs.org/dist/index.json"));
  assertEquals(line?.includes("2>/dev/null"), true);
});
