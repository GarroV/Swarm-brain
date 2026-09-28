// Контракт профиля бота (D029, T177): бот и сервер согласованы одной проверкой.
//
// Почему тест, а не «бот берёт значения с сервера»: значения нужны контейнеру до первого запроса и
// без сети (имя в поле входа, ожидание у двери), а раскатка идёт одним куском (D033) — сверка
// до слияния дешевле и надёжнее, чем ещё одна зависимость бота от живого сервера на старте встречи.
//
// Что разъедется молча без этой проверки: сервер пишет человеку «ждёт у двери 90 секунд», а бот
// ждёт 60; сервер отпускает второй сигнал двери, а бот ждёт третьего; бот живёт на встрече дольше,
// чем действует его пропуск; сторож объявляет бота мёртвым между двумя нормальными ударами.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BOT_PROFILE as SERVER } from "./bot-profile.ts";
import { BOT_PROFILE as BOT } from "../../../bot/src/orchestrator/profile.ts";

Deno.test("БЛОКИРУЮЩИЙ: имя и площадки бота на сервере и в боте одни", () => {
  assertEquals(SERVER.name, BOT.name, "имя бота: сервер пишет людям одно, в звонок входит другое");
  assertEquals(
    [...SERVER.platforms],
    [...BOT.platforms],
    "площадки: сервер заведёт приглашение, которое бот отвергнет",
  );
});

Deno.test("БЛОКИРУЮЩИЙ: дверь — тайминги и число сигналов совпадают", () => {
  assertEquals(SERVER.door.waitSeconds * 1000, BOT.door.waitMs, "ожидание у двери: текст людям врёт о времени");
  assertEquals(SERVER.door.repeatSeconds * 1000, BOT.door.repeatMs, "пауза до повтора");
  assertEquals(SERVER.door.maxAttempts, BOT.door.maxNotices, "число сигналов двери: сервер отобьёт лишний");
});

Deno.test("БЛОКИРУЮЩИЙ: потолок длины встречи один, пропуск его переживает", () => {
  assertEquals(SERVER.maxMeetingMinutes, BOT.maxMeetingMinutes, "потолок длины встречи");
  assert(SERVER.uploadTailMinutes > 0, "после потолка нужен хвост на досылку частей");
});

Deno.test("БЛОКИРУЮЩИЙ: сторож тишины переживает пару пропущенных ударов бота", () => {
  assert(
    SERVER.silentMinutes * 60_000 >= 3 * BOT.heartbeatMs,
    `порог тишины ${SERVER.silentMinutes} мин против удара раз в ${BOT.heartbeatMs} мс: ложный алерт`,
  );
});
