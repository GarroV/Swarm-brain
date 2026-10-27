import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { BRIDGE_SCRIPT, BRIDGE_VERSION, MERGE_FUNCTION, SETUP_SCRIPT, sha256Hex } from "./mcp-setup-script.ts";
import { buildSetupOneLiner } from "./mcp-token.ts";

// Тесты установщика Claude Desktop. Скрипт правит ЧУЖОЙ файл конфигурации пользователя, где уже
// могут жить другие MCP-серверы, и рапортует об успехе — здесь закрыты три класса:
//   1) мёрж — прогоняется НАСТОЯЩАЯ функция merge_config из mcp-setup-script.ts (импортом, не копией:
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
  const cmd = new Deno.Command("bash", {
    args: ["-c", script, "bash", cfgPath, SRV_JSON],
    stdout: "piped",
    stderr: "piped",
  });
  const { code } = await cmd.output();
  const raw = await Deno.readTextFile(cfgPath).catch(() => "");
  await Deno.remove(dir, { recursive: true });
  return { code, raw };
}

// deno-lint-ignore no-explicit-any -- разбор произвольного конфига в тесте
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
  const writeAt = SETUP_SCRIPT.indexOf('merge_config "$CONFIG"');
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
  assertStringIncludes(BRIDGE_SCRIPT, "continue"); // нет id — ничего не печатаем
  // Токен не должен попадать в аргументы процесса — иначе он виден в ps любому на машине.
  assertEquals(BRIDGE_SCRIPT.includes("smcp_"), false);
});

// --- Мост при сбое (issue #935): живой прогон настоящего моста против фейкового сервера ---
// Мост не должен молчать: на запрос с id клиент ждёт ответ с тем же id, иначе висит 30 минут.

type FakeHandler = (req: Request) => Response | Promise<Response>;

async function runBridge(handler: FakeHandler | null, input: string): Promise<{ out: string; ms: number }> {
  const dir = await Deno.makeTempDir();
  const bridgePath = `${dir}/bridge.sh`;
  await Deno.writeTextFile(bridgePath, BRIDGE_SCRIPT);
  const server = handler ? Deno.serve({ port: 0, onListen() {}, hostname: "127.0.0.1" }, handler) : null;
  // Без сервера — порт, на котором никто не слушает (мгновенный отказ соединения).
  const port = server ? (server.addr as Deno.NetAddr).port : 1;
  const started = Date.now();
  try {
    const child = new Deno.Command("bash", {
      args: [bridgePath],
      env: {
        SWARM_MCP_URL: `http://127.0.0.1:${port}/mcp`,
        SWARM_MCP_AUTH: "Bearer test",
        SWARM_MCP_MAX_TIME: "2",
      },
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    }).spawn();
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(input));
    await w.close();
    const { stdout } = await child.output();
    return { out: new TextDecoder().decode(stdout), ms: Date.now() - started };
  } finally {
    if (server) await server.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
}

// «Не отвечает»: висим, пока клиент (curl по --max-time) не закроет соединение — иначе shutdown зависнет.
const hangUntilClosed: FakeHandler = (req) =>
  new Promise<Response>((resolve) =>
    req.signal.addEventListener("abort", () => resolve(new Response(null, { status: 499 })))
  );

const REQ7 = '{"jsonrpc":"2.0","id":7,"method":"tools/list"}\n';
const CLOUD_402 = () =>
  new Response('{"message":"Service for this project is restricted \\"quota\\""}', { status: 402 });

Deno.test("мост: HTTP 402 старого облака даёт JSON-RPC error с тем же id и подсказкой про переезд", async () => {
  const { out } = await runBridge(CLOUD_402, REQ7);
  const msg = JSON.parse(out.trim());
  assertEquals(msg.jsonrpc, "2.0");
  assertEquals(msg.id, 7);
  assertEquals(msg.error.code, -32000);
  assertStringIncludes(msg.error.message, "HTTP 402");
  assertStringIncludes(msg.error.message, "Service for this project is restricted");
  assertStringIncludes(msg.error.message, "Swarm moved to a new server");
  assertStringIncludes(msg.error.message, "Swarm переехал на новый сервер");
});

Deno.test("мост: строковый id с пробелами вокруг двоеточия сохраняется как есть", async () => {
  const { out } = await runBridge(CLOUD_402, '{"jsonrpc":"2.0", "id" : "abc-1","method":"x"}\n');
  assertEquals(JSON.parse(out.trim()).id, "abc-1");
});

Deno.test("мост: валидный ответ JSON-RPC проходит как есть", async () => {
  const ok = '{"jsonrpc":"2.0","id":7,"result":{"tools":[]}}';
  const { out } = await runBridge(() => new Response(ok, { status: 200 }), REQ7);
  assertEquals(out.trim(), ok);
});

Deno.test("мост: сервер не отвечает за MAX_TIME — error с тем же id, а не тишина", async () => {
  const { out, ms } = await runBridge(hangUntilClosed, REQ7);
  const msg = JSON.parse(out.trim());
  assertEquals(msg.id, 7);
  assertStringIncludes(msg.error.message, "no response");
  assertEquals(ms < 10000, true);
});

Deno.test("мост: сервер недоступен (отказ соединения) — error с подсказкой про переезд", async () => {
  const { out } = await runBridge(null, REQ7);
  const msg = JSON.parse(out.trim());
  assertEquals(msg.id, 7);
  assertStringIncludes(msg.error.message, "Swarm moved to a new server");
});

Deno.test("мост: 200 без JSON-RPC в теле — error, а не мусор в stdout", async () => {
  const { out } = await runBridge(() => new Response("<html>oops</html>", { status: 200 }), REQ7);
  const msg = JSON.parse(out.trim());
  assertEquals(msg.id, 7);
  assertStringIncludes(msg.error.message, "not a JSON-RPC response");
});

Deno.test("мост: уведомление (без id) остаётся молчаливым даже при сбое", async () => {
  const { out } = await runBridge(CLOUD_402, '{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  assertEquals(out, "");
});

// --- Мост: 401 (#1082) ---

Deno.test("мост: HTTP 401 — error с тем же id и текстом «выпусти новый токен в Настройках»", async () => {
  const { out } = await runBridge(() => new Response('{"message":"bad"}', { status: 401 }), REQ7);
  const msg = JSON.parse(out.trim());
  assertEquals(msg.id, 7);
  assertStringIncludes(msg.error.message, "HTTP 401");
  assertStringIncludes(msg.error.message, "issue a new one in Settings");
  assertStringIncludes(msg.error.message, "выпусти новый в Настройках");
});

// --- Само-обновление моста (#1082, #951) ---
// Живой прогон настоящего моста против фейкового swarm-setup: версия новее — файл подменяется
// через mv (новый inode), отпечаток не сошёлся или версия не новее — файл не тронут.

const NEWER_BRIDGE = BRIDGE_SCRIPT.replace(`BRIDGE_VERSION=${BRIDGE_VERSION}`, `BRIDGE_VERSION=${BRIDGE_VERSION + 1}`);

async function runUpdate(
  info: { version: number; sha256: string } | null,
  body: string,
): Promise<{ changed: boolean; text: string; inodeChanged: boolean; leftovers: string[] }> {
  const dir = await Deno.makeTempDir();
  const bridgePath = `${dir}/bridge.sh`;
  await Deno.writeTextFile(bridgePath, BRIDGE_SCRIPT);
  const inodeBefore = (await Deno.stat(bridgePath)).ino;
  const server = Deno.serve({ port: 0, onListen() {}, hostname: "127.0.0.1" }, (req) => {
    const path = new URL(req.url).pathname;
    if (path.endsWith("/swarm-setup/version") && info) return new Response(JSON.stringify(info));
    if (path.endsWith("/swarm-setup/bridge")) return new Response(body);
    return new Response("{}", { status: 404 });
  });
  const port = (server.addr as Deno.NetAddr).port;
  try {
    const child = new Deno.Command("bash", {
      args: [bridgePath],
      env: { SWARM_MCP_URL: `http://127.0.0.1:${port}/swarm-mcp`, SWARM_MCP_AUTH: "Bearer t" },
      stdin: "null",
      stdout: "null",
      stderr: "null",
    }).output();
    await child; // stdin закрыт — мост выходит, а обновление идёт в фоне: ждём его немного
    let text = BRIDGE_SCRIPT;
    for (let i = 0; i < 15; i++) {
      text = await Deno.readTextFile(bridgePath);
      if (text !== BRIDGE_SCRIPT) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const leftovers = [];
    for await (const e of Deno.readDir(dir)) if (e.name.startsWith(".bridge-update")) leftovers.push(e.name);
    return {
      changed: text !== BRIDGE_SCRIPT,
      text,
      inodeChanged: (await Deno.stat(bridgePath)).ino !== inodeBefore,
      leftovers,
    };
  } finally {
    await server.shutdown();
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("самообновление: версия новее и отпечаток сошёлся — файл подменён через mv (новый inode)", async () => {
  const sha = await sha256Hex(NEWER_BRIDGE);
  const r = await runUpdate({ version: BRIDGE_VERSION + 1, sha256: sha }, NEWER_BRIDGE);
  assertEquals(r.changed, true);
  assertEquals(r.text, NEWER_BRIDGE);
  assertEquals(r.inodeChanged, true);
  assertEquals(r.leftovers, []);
});

Deno.test("самообновление: отпечаток НЕ сошёлся — мост остаётся прежним, временный файл убран", async () => {
  const r = await runUpdate({ version: BRIDGE_VERSION + 1, sha256: "0".repeat(64) }, NEWER_BRIDGE);
  assertEquals(r.changed, false);
  assertEquals(r.leftovers, []);
});

Deno.test("самообновление: версия не новее своей — ничего не качается и не меняется", async () => {
  const sha = await sha256Hex(NEWER_BRIDGE);
  const r = await runUpdate({ version: BRIDGE_VERSION, sha256: sha }, NEWER_BRIDGE);
  assertEquals(r.changed, false);
});

Deno.test("самообновление: новый текст не проходит bash -n — мост не заменяется", async () => {
  const broken = "if then fi (((\n";
  const r = await runUpdate({ version: BRIDGE_VERSION + 1, sha256: await sha256Hex(broken) }, broken);
  assertEquals(r.changed, false);
});

Deno.test("самообновление: сервер без /version — мост живёт как жил", async () => {
  const r = await runUpdate(null, NEWER_BRIDGE);
  assertEquals(r.changed, false);
});

Deno.test("версия моста поднимается вместе с текстом: пара «версия ↔ отпечаток» зафиксирована", async () => {
  // Если тест упал — вы поменяли BRIDGE_SCRIPT. Поднимите BRIDGE_VERSION (иначе у людей мост не
  // обновится, сервер отдаст ту же версию) и впишите сюда новую пару.
  const PINNED = { version: 2, sha256: "59d5b370e5e2523894350da8d021ca87d61ea3cbf54c02d4c73c9c960c351344" };
  assertEquals(BRIDGE_VERSION, PINNED.version, "версия моста сменилась — обновите PINNED в тесте");
  assertEquals(
    await sha256Hex(BRIDGE_SCRIPT),
    PINNED.sha256,
    "текст моста сменился — поднимите BRIDGE_VERSION и PINNED",
  );
});

// --- Установщик (#951, #1082) ---

Deno.test("установщик: мост пишется во временный файл и подменяется mv, а не cat > в тот же файл (#951)", () => {
  const code = SETUP_SCRIPT.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assertStringIncludes(code, 'mv -f "$BRIDGE_TMP" "$BRIDGE"');
  assertEquals(code.includes('cat > "$BRIDGE" '), false);
  assertEquals(code.includes('cat > "$BRIDGE"<'), false);
});

Deno.test("установщик: тело моста в heredoc побайтно равно тому, что сервер отдаёт на /bridge", async () => {
  const start = SETUP_SCRIPT.indexOf("<<'SWARM_BRIDGE_EOF'\n") + "<<'SWARM_BRIDGE_EOF'\n".length;
  const end = SETUP_SCRIPT.indexOf("SWARM_BRIDGE_EOF\n", start);
  assertEquals(SETUP_SCRIPT.slice(start, end), BRIDGE_SCRIPT);
  // Отпечаток, который сверит само-обновление, совпадает с отпечатком файла, записанного установщиком.
  assertEquals(await sha256Hex(SETUP_SCRIPT.slice(start, end)), await sha256Hex(BRIDGE_SCRIPT));
});

Deno.test("установщик и мост проходят bash -n", async () => {
  for (const [name, text] of [["setup", SETUP_SCRIPT], ["bridge", BRIDGE_SCRIPT]]) {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(`${dir}/${name}.sh`, text);
      const { code, stderr } = await new Deno.Command("bash", { args: ["-n", `${dir}/${name}.sh`], stderr: "piped" })
        .output();
      assertEquals(code, 0, new TextDecoder().decode(stderr));
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  }
});

Deno.test("bash-скрипты: имена переменных только латиницей (кириллица проходит bash -n, но падает у человека)", () => {
  for (const text of [SETUP_SCRIPT, BRIDGE_SCRIPT]) {
    const bad = text.split("\n").filter((l) => /^\s*[A-Za-z_]*[А-Яа-яЁё]\w*=/.test(l));
    assertEquals(bad, []);
  }
});

Deno.test("установщик: Claude Code прописывается через claude mcp remove + add --transport http (user scope)", () => {
  assertStringIncludes(SETUP_SCRIPT, "mcp remove swarm-brain --scope user");
  assertStringIncludes(SETUP_SCRIPT, 'mcp add --transport http swarm-brain "$MCP_URL"');
  assertStringIncludes(SETUP_SCRIPT, '--header "Authorization: Bearer $SWARM_TOKEN" --scope user');
});

Deno.test("команда установки: SHA-256 скрипта сверяется ДО запуска, токен — в окружении, не в аргументах", async () => {
  const cmd = await buildSetupOneLiner("smcp_abc123");
  const sha = await sha256Hex(SETUP_SCRIPT);
  assertStringIncludes(cmd, `echo "${sha}  $f" | shasum -a 256 -c -`);
  assertEquals(cmd.indexOf("shasum -a 256 -c") < cmd.indexOf("bash "), true);
  assertEquals(cmd.indexOf("shasum -a 256 -c") < cmd.indexOf("SWARM_TOKEN="), true);
  assertStringIncludes(cmd, "SWARM_TOKEN='smcp_abc123' bash \"$f\"");
  // Слепого curl | bash больше нет.
  assertEquals(/curl[^|]*\|\s*(SWARM_TOKEN=\S+\s+)?bash/.test(cmd), false);
});

// Полный прогон установщика в песочнице: домашняя папка во временной папке, фейковые claude/open/
// pgrep/osascript в PATH (реальный Claude Desktop не трогаем), настоящий plutil, фейковый сервер.
macOnly("установщик: прогон целиком — мост через mv, Desktop-конфиг, Claude Code зарегистрирован", async () => {
  const home = await Deno.makeTempDir();
  const fakeBin = `${home}/fakebin`;
  await Deno.mkdir(fakeBin);
  const callLog = `${home}/claude-calls.log`;
  await Deno.writeTextFile(`${fakeBin}/claude`, `#!/bin/bash\nprintf '%s\\n' "$*" >> '${callLog}'\n`);
  for (const n of ["open", "osascript"]) await Deno.writeTextFile(`${fakeBin}/${n}`, "#!/bin/bash\nexit 0\n");
  await Deno.writeTextFile(`${fakeBin}/pgrep`, "#!/bin/bash\nexit 1\n");
  for (const n of ["claude", "open", "osascript", "pgrep"]) await Deno.chmod(`${fakeBin}/${n}`, 0o755);
  const server = Deno.serve(
    { port: 0, onListen() {}, hostname: "127.0.0.1" },
    () => new Response('{"jsonrpc":"2.0","id":1,"result":{"content":[]}}'),
  );
  const port = (server.addr as Deno.NetAddr).port;
  try {
    const script = SETUP_SCRIPT.replace(/^MCP_URL=".*"$/m, `MCP_URL="http://127.0.0.1:${port}/swarm-mcp"`);
    await Deno.writeTextFile(`${home}/setup.sh`, script);
    const { code, stdout, stderr } = await new Deno.Command("/bin/bash", {
      args: [`${home}/setup.sh`],
      env: { HOME: home, PATH: `${fakeBin}:/usr/bin:/bin`, SWARM_TOKEN: "smcp_testtoken" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const out = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);
    assertEquals(code, 0, out);
    const bridge = `${home}/.swarm-brain/bin/swarm-mcp-bridge.sh`;
    assertEquals(await Deno.readTextFile(bridge), BRIDGE_SCRIPT);
    assertEquals((((await Deno.stat(bridge)).mode ?? 0) & 0o111) > 0, true);
    for await (const e of Deno.readDir(`${home}/.swarm-brain/bin`)) {
      assertEquals(e.name.startsWith(".bridge-install"), false, "остался временный файл установщика");
    }
    const cfg = JSON.parse(
      await Deno.readTextFile(`${home}/Library/Application Support/Claude/claude_desktop_config.json`),
    );
    assertEquals(cfg.mcpServers["swarm-brain"].command, "/bin/bash");
    const calls = (await Deno.readTextFile(callLog)).trim().split("\n");
    assertEquals(calls[0], "mcp remove swarm-brain --scope user");
    assertEquals(
      calls[1],
      `mcp add --transport http swarm-brain http://127.0.0.1:${port}/swarm-mcp --header Authorization: Bearer smcp_testtoken --scope user`,
    );
  } finally {
    await server.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
