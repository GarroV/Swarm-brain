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

/** Эндпоинты, куда ходит бот: пять штук, все через resolveActingIdentity. */
const BOT_DOORS = [
  "meeting-current",
  "meeting-claim",
  "meeting-ingest",
  "meeting-heartbeat",
  "meeting-status",
];

/** Эндпоинты, закрытые для агентов наглухо. */
const HUMAN_ONLY = ["meeting-webtoken"];

async function source(fn: string): Promise<string> {
  return await Deno.readTextFile(`${ROOT}${fn}/index.ts`);
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
