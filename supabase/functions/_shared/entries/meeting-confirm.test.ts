// Согласование встречи («confirmed») меняет ТОЛЬКО признак согласования: видимость, круг
// «разделено с» и владелец остаются как были. Ядро прав — тесты до кода.
import { assertEquals } from "jsr:@std/assert@1";
import { meetingConfirmPatch } from "./meeting-confirm.ts";

Deno.test("согласование пишет только metadata.confirmed и сохраняет остальную metadata", () => {
  const patch = meetingConfirmPatch({ title: "1-1", attendees: [{ email: "a@x.io" }], confirmed: false });
  assertEquals(patch, { metadata: { title: "1-1", attendees: [{ email: "a@x.io" }], confirmed: true } });
});

Deno.test("согласование не трогает видимость, владельца и shared_with", () => {
  const keys = Object.keys(meetingConfirmPatch({}));
  assertEquals(keys, ["metadata"]);
});

Deno.test("согласование встречи без metadata работает", () => {
  assertEquals(meetingConfirmPatch(null), { metadata: { confirmed: true } });
});
