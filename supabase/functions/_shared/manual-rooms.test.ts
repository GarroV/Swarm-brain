// «Бота на эту комнату уже позвали руками» — одно правило на двоих: автозапуск (meeting-calendar,
// не ведёт второго бота) и сигнал «бот не пришёл» (meeting-missed, молчит). Разойдись они — и
// сигнал гаснет там, где бот на деле не едет: мёртвое приглашение утром глушило пропуск вечером.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { coveredRooms, inviteCoversRoom, type ManualInviteRow } from "./manual-rooms.ts";

const NOW = Date.parse("2026-09-28T17:00:00.000Z");
const LINK = "https://meet.google.com/abc-defg-hij";

function row(over: Partial<ManualInviteRow> = {}): ManualInviteRow {
  return {
    join_url: LINK,
    used_at: null,
    expires_at: "2026-09-28T17:10:00.000Z",
    meetings: null,
    ...over,
  };
}

Deno.test("живое приглашение (не погашено, не истекло) — комната занята: бот едет", () => {
  assertEquals(inviteCoversRoom(row(), NOW), true);
});

Deno.test("истёкшее и не погашенное — комната свободна: бот не приехал и не приедет", () => {
  assertEquals(inviteCoversRoom(row({ expires_at: "2026-09-28T09:15:00.000Z" }), NOW), false);
});

Deno.test("погашенное, бот встречу закончил — комната свободна (утренний стендап не глушит вечер)", () => {
  const used = row({
    used_at: "2026-09-28T09:01:00.000Z",
    expires_at: "2026-09-28T09:15:00.000Z",
    meetings: { agent_last_recording: false, lease_expires_at: "2026-09-28T10:00:00.000Z" },
  });
  assertEquals(inviteCoversRoom(used, NOW), false);
});

Deno.test("погашенное, бот пишет прямо сейчас — комната занята: бот уже в звонке", () => {
  const used = row({
    used_at: "2026-09-28T16:50:00.000Z",
    expires_at: "2026-09-28T17:05:00.000Z",
    meetings: { agent_last_recording: true, lease_expires_at: "2026-09-28T17:25:00.000Z" },
  });
  assertEquals(inviteCoversRoom(used, NOW), true);
});

Deno.test("погашенное, флаг записи остался, но лиз истёк — бот мёртв, комната свободна", () => {
  const used = row({
    used_at: "2026-09-28T16:00:00.000Z",
    meetings: { agent_last_recording: true, lease_expires_at: "2026-09-28T16:59:00.000Z" },
  });
  assertEquals(inviteCoversRoom(used, NOW), false);
});

Deno.test("погашенное без встречи (встречу удалили) — комната свободна", () => {
  assertEquals(inviteCoversRoom(row({ used_at: "2026-09-28T16:50:00.000Z", meetings: null }), NOW), false);
});

Deno.test("coveredRooms: комнаты только покрывающих приглашений; кривая ссылка пропускается", () => {
  const rooms = coveredRooms([
    row(),
    row({ join_url: "https://meet.google.com/zzz-zzzz-zzz", expires_at: "2026-09-28T09:15:00.000Z" }),
    row({ join_url: "not a link" }),
  ], NOW);
  assertEquals([...rooms].length, 1);
});

/** Корень находки: у каждой функции был свой запрос с разной семантикой. Теперь запрос один. */
Deno.test("meeting-calendar и meeting-missed берут комнаты из _shared/manual-rooms.ts, а не своим запросом", async () => {
  const root = new URL("../", import.meta.url).pathname;
  for (const fn of ["meeting-calendar", "meeting-missed"]) {
    const text = await Deno.readTextFile(`${root}${fn}/index.ts`);
    assertEquals(text.includes("_shared/manual-rooms.ts"), true, `${fn}: правило комнат — из _shared/manual-rooms.ts`);
    assertEquals(
      text.includes('from("meeting_invites")'),
      false,
      `${fn}: своего запроса к meeting_invites быть не должно`,
    );
  }
});
