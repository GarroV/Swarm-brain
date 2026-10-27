// Подпись «записали» (#1070 п.5): в имена попадает тот, кто транскрибирует или реально записал
// секунды. Бот с 0 с, которого заменили (superseded), записавшим не значится.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { creditedRecorderIds } from "./recorder-credit.ts";

Deno.test("держатель права (transcribe) подписан, даже если секунды ещё не набежали", () => {
  assertEquals(creditedRecorderIds([{ telegram_id: 1, role: "transcribe" }]), [1]);
});

Deno.test("ЯДРО #1070: бот с нулём секунд, которого заменили, не записавший", () => {
  const recorders = [
    { telegram_id: 1, role: "superseded", recorded_seconds: 0 },
    { telegram_id: 2, role: "transcribe", recorded_seconds: 1800 },
  ];
  assertEquals(creditedRecorderIds(recorders), [2]);
});

Deno.test("отклонённый или замещённый, но с реальной записью — записавший", () => {
  assertEquals(
    creditedRecorderIds([
      { telegram_id: 1, role: "superseded", recorded_seconds: 600 },
      { telegram_id: 2, role: "defer", recorded_seconds: 30 },
      { telegram_id: 3, role: "defer" },
      { telegram_id: 4, role: "challenger", recorded_seconds: 0 },
    ]),
    [1, 2],
  );
});

Deno.test("мусор в recorders не ломает: не массив, без id, секунды не числом", () => {
  assertEquals(creditedRecorderIds(null), []);
  assertEquals(creditedRecorderIds([{ role: "transcribe" }, null, { telegram_id: 5, recorded_seconds: "9" }]), []);
});
