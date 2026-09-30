// Подсказка-глоссарий Whisper по источнику выгрузки (#620). Ошибка здесь молчит и бьёт по проду:
// снятая у рекордера подсказка тихо ухудшит написание имён во всех стенограммах команды, а
// оставленная у бота вернёт пустые стенограммы его встреч.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BOT_PROFILE, useGlossaryHint } from "./bot-profile.ts";

Deno.test("БЛОКИРУЮЩИЙ: запись человека (рекордер) идёт с подсказкой", () => {
  assertEquals(useGlossaryHint("person"), true);
});

Deno.test("БЛОКИРУЮЩИЙ: состояние без источника (старые встречи) — с подсказкой, как раньше", () => {
  assertEquals(useGlossaryHint(undefined), true);
});

Deno.test("БЛОКИРУЮЩИЙ: запись бота решает профиль бота — сейчас без подсказки", () => {
  assertEquals(BOT_PROFILE.whisperGlossaryHint, false);
  assertEquals(useGlossaryHint("agent:scriba:7100000001"), false);
});
