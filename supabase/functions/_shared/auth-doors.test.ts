// Дверей две, и разница между ними — не стилистическая.
//
// `resolveActingIdentity` пускает служебного агента и разрешает ему действовать от имени
// человека. `verifyAgentToken` агентов не пускает вовсе. По второй двери ходит
// `meeting-webtoken`, который печатает JWT браузерной сессии на семь дней: агент, прошедший
// там «от имени человека», стал бы этим человеком в вебе — не на одну операцию, а на неделю.
//
// Тест структурный: он смотрит, какой функцией каждый эндпоинт проверяет вход. Такую правку
// («давай везде одинаково») легко внести из лучших побуждений, и ни один поведенческий тест
// её не поймает — поведение для человека не изменится.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../", import.meta.url).pathname;

/** Эндпоинты, куда ходит бот за человека: шесть штук, все через resolveActingIdentity. */
const BOT_DOORS = [
  "meeting-current",
  "meeting-claim",
  "meeting-ingest",
  "meeting-heartbeat",
  "meeting-status",
  "meeting-notice",
];

/** Эндпоинты, закрытые для агентов наглухо. */
const HUMAN_ONLY = ["meeting-webtoken"];

/**
 * Весь рабочий код функции, а не только index.ts: вход может жить в соседнем модуле
 * (meeting-notice держит его в handle.ts, чтобы ручку можно было звать из теста).
 * Тесты не читаются — упоминание двери в тесте не делает её дверью.
 */
async function source(fn: string): Promise<string> {
  const parts: string[] = [];
  for await (const entry of Deno.readDir(`${ROOT}${fn}`)) {
    if (!entry.isFile || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
    parts.push(await Deno.readTextFile(`${ROOT}${fn}/${entry.name}`));
  }
  return parts.join("\n");
}

for (const fn of BOT_DOORS) {
  Deno.test(`${fn}: бот проходит — дверь resolveActingIdentity`, async () => {
    const src = await source(fn);
    assert(
      src.includes("resolveActingIdentity("),
      `${fn} не зовёт resolveActingIdentity: бот в него не попадёт, хотя должен`,
    );
  });
}

for (const fn of HUMAN_ONLY) {
  Deno.test(`БЛОКИРУЮЩИЙ: ${fn} не пускает агентов — иначе бот выменял бы веб-сессию`, async () => {
    const src = await source(fn);
    assertEquals(
      src.includes("resolveActingIdentity("),
      false,
      `${fn} переведён на resolveActingIdentity: агент сможет получить JWT браузерной ` +
        `сессии человека на семь дней. Это не «единообразие», это смена уровня доступа.`,
    );
    assert(
      src.includes("verifyAgentToken("),
      `${fn} должен проверять вход через verifyAgentToken`,
    );
  });
}

/**
 * Эндпоинты агента «сам за себя» (D017): оркестратор забирает приглашения своего воркспейса.
 * Дверь — resolveServiceAgent: только агент, без подмены и без человеческой личности на выходе.
 */
const AGENT_SELF = ["meeting-invite"];

for (const fn of AGENT_SELF) {
  Deno.test(`БЛОКИРУЮЩИЙ: ${fn} — дверь resolveServiceAgent, не человеческая и не подмены`, async () => {
    const src = await source(fn);
    assert(src.includes("resolveServiceAgent("), `${fn} не зовёт resolveServiceAgent`);
    assertEquals(
      src.includes("resolveActingIdentity(") || src.includes("verifyAgentToken("),
      false,
      `${fn} пускает по двери человека: приглашения воркспейса увидел бы личный токен любого сотрудника`,
    );
  });
}
