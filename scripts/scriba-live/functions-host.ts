// Хост функций стенда живого прогона бота scriba (T004).
//
// Поднимает НАСТОЯЩИЕ edge-функции с ветки процессами Deno внутри своего контейнера и отдаёт их
// одним портом так же, как Supabase: /functions/v1/<имя>/… Прод здесь не участвует: база —
// локальный контур `supabase start` на MUSPELHEIM, Telegram подменён всегда, OpenAI — пока
// живой ключ не положен в стенд (см. docs/furca/live-run-T004.md, «Живая транскрибация»).
//
// Что даёт хост, кроме маршрутизации:
//   • поддельный Telegram: каждое сообщение, которое функции отправили бы человеку, пишется
//     строкой JSON в $STAND_STATE/telegram.jsonl — так видно уведомление «бота не впустили»;
//   • поддельный OpenAI (только без живого ключа): распознавание отдаёт реплики по длине части,
//     тезисы — короткий текст, эмбеддинги — вектор из нулей. Встреча доходит до очереди вычитки;
//   • cron meeting-process раз в минуту, как в проде: длинную встречу добивает он.
//
// Порты функций внутри контейнера (9101+) наружу не публикуются; наружу — только $STAND_PORT.

const STATE = Deno.env.get("STAND_STATE") ?? "/state";
const PORT = Number(Deno.env.get("STAND_PORT") ?? "8000");
const FAKE_PORT = 9100;
const FIRST_FN_PORT = 9101;
const CRON_MS = 60_000;
const FAKE_OPENAI = Deno.env.get("OPENAI_API_KEY")?.startsWith("stand-fake") ?? true;

const FUNCTIONS = [
  "swarm-api",
  "meeting-invite",
  "meeting-claim",
  "meeting-ingest",
  "meeting-process",
  "meeting-heartbeat",
  "meeting-notice",
  "meeting-status",
  "meeting-current",
  "meeting-calendar",
] as const;

const REPO = new URL("../../", import.meta.url).pathname;
const telegramLog = `${STATE}/telegram.jsonl`;

function log(line: string): void {
  console.log(`[functions ${new Date().toISOString()}] ${line}`);
}

// ── Поддельные внешние службы ────────────────────────────────────────────────

const BYTES_PER_SECOND = 32_000 / 8; // битрейт бота — 32 кбит/с
const SEGMENT_SECONDS = 10;
const EMBEDDING_DIMENSIONS = 1536;

async function fakeTranscription(req: Request): Promise<Response> {
  const form = await req.formData();
  const file = form.get("file");
  const size = file instanceof File ? file.size : 0;
  const seconds = Math.max(SEGMENT_SECONDS, Math.round(size / BYTES_PER_SECOND));
  const count = Math.floor(seconds / SEGMENT_SECONDS);
  const segments = Array.from({ length: count }, (_, i) => ({
    start: i * SEGMENT_SECONDS,
    end: i * SEGMENT_SECONDS + SEGMENT_SECONDS - 1,
    text: `Поддельная реплика ${i + 1}: стенд без живого ключа OpenAI, звук не распознавался`,
    no_speech_prob: 0.01,
    avg_logprob: -0.2,
  }));
  log(`поддельный OpenAI: распознавание части ${size} байт → ${count} реплик`);
  return Response.json({ text: segments.map((s) => s.text).join(" "), language: "russian", segments });
}

function fakeChat(): Response {
  return Response.json({
    choices: [{
      message: { content: "- Стенд живого прогона: тезисы поддельные, распознавание без OpenAI" },
      finish_reason: "stop",
    }],
  });
}

function fakeEmbeddings(): Response {
  return Response.json({ data: [{ embedding: new Array(EMBEDDING_DIMENSIONS).fill(0) }] });
}

async function fakeTelegram(req: Request, path: string): Promise<Response> {
  const method = path.split("/").pop() ?? "";
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const line = JSON.stringify({
    at: new Date().toISOString(),
    method,
    chat_id: body.chat_id ?? null,
    text: body.text ?? null,
  });
  await Deno.writeTextFile(telegramLog, line + "\n", { append: true });
  log(`поддельный Telegram: ${method} → ${String(body.chat_id)}`);
  return Response.json({ ok: true, result: { message_id: Date.now() } });
}

function startFake(): void {
  Deno.serve({ hostname: "127.0.0.1", port: FAKE_PORT, onListen: () => {} }, async (req) => {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/bot")) return await fakeTelegram(req, path);
    if (path === "/v1/audio/transcriptions") return await fakeTranscription(req);
    if (path === "/v1/chat/completions") return fakeChat();
    if (path === "/v1/embeddings") return fakeEmbeddings();
    return new Response("not found", { status: 404 });
  });
}

// ── Функции ──────────────────────────────────────────────────────────────────

const hosts = ["https://api.telegram.org", ...(FAKE_OPENAI ? ["https://api.openai.com"] : [])];
const PRELOAD = `data:application/typescript,${
  encodeURIComponent(`
const real = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  for (const host of ${JSON.stringify(hosts)}) {
    if (url.startsWith(host + "/")) {
      const target = url.replace(host, "http://127.0.0.1:${FAKE_PORT}");
      return real(input instanceof Request ? new Request(target, input) : target, init);
    }
  }
  return real(input, init);
};`)
}`;

const ports = new Map<string, number>();

function spawn(name: string, port: number): void {
  const child = new Deno.Command("deno", {
    args: ["run", "--allow-all", `--preload=${PRELOAD}`, `${REPO}supabase/functions/${name}/index.ts`],
    env: { DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}` },
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  child.status.then((status) => {
    log(`ФУНКЦИЯ ${name} УПАЛА (код ${status.code}) — перезапуск через 3 с`);
    setTimeout(() => spawn(name, port), 3000);
  });
}

async function proxy(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/health") {
    const states = await Promise.all(
      [...ports].map(async ([name, port]) => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/`, { method: "OPTIONS" });
          await res.body?.cancel();
          return [name, true] as const;
        } catch {
          return [name, false] as const;
        }
      }),
    );
    const down = states.filter(([, up]) => !up).map(([name]) => name);
    return Response.json({ ok: down.length === 0, down, fake_openai: FAKE_OPENAI }, {
      status: down.length === 0 ? 200 : 503,
    });
  }
  const match = url.pathname.match(/^\/functions\/v1\/([a-z-]+)(\/.*)?$/);
  const port = match ? ports.get(match[1]) : undefined;
  if (port === undefined) return new Response("no such function on stand", { status: 404 });
  const target = `http://127.0.0.1:${port}${url.pathname}${url.search}`;
  const headers = new Headers(req.headers);
  headers.delete("host");
  try {
    return await fetch(target, {
      method: req.method,
      headers,
      body: req.body,
      redirect: "manual",
    });
  } catch (error) {
    return new Response(`function ${match![1]} unreachable: ${String(error)}`, { status: 502 });
  }
}

async function cronMeetingProcess(): Promise<void> {
  const port = ports.get("meeting-process");
  const secret = Deno.env.get("CRON_SECRET") ?? "";
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: "POST",
      headers: { "X-Cron-Secret": secret, "Content-Type": "application/json" },
      body: "{}",
    });
    const text = await res.text();
    if (!res.ok || !text.includes('"candidates":0')) log(`cron meeting-process: ${res.status} ${text.slice(0, 200)}`);
  } catch (error) {
    log(`cron meeting-process: недоступна (${String(error)})`);
  }
}

startFake();
FUNCTIONS.forEach((name, i) => {
  ports.set(name, FIRST_FN_PORT + i);
  spawn(name, FIRST_FN_PORT + i);
});
setInterval(cronMeetingProcess, CRON_MS);
Deno.serve({ hostname: "0.0.0.0", port: PORT, onListen: () => {} }, proxy);
log(
  `хост функций слушает :${PORT}; функций ${FUNCTIONS.length}; OpenAI ${
    FAKE_OPENAI ? "ПОДДЕЛЬНЫЙ" : "живой"
  }; Telegram поддельный → ${telegramLog}`,
);
