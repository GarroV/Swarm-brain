// Серверный бэкап отклонённой записи (backup_only=1, #1070): кто может, что пишется, замена повтора,
// отказы. Ядро хранения исходников: ошибка здесь тихо теряет запись, которую обещали сохранить на 3 дня.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeBackupDb } from "../_shared/backup-fake.ts";
import { backupPartPath, handleBackupUpload, mayBackup, parseBackupReason, parseOptionalNumber } from "./backup.ts";

const MEETING = { id: "m1", claim_owner: 10, group_id: "g", recorders: [{ telegram_id: 20, role: "defer" }] };
const SOURCE = "person:20";

function form(extra: Record<string, string> = {}, files = ["a"]): FormData {
  const f = new FormData();
  f.set("meeting_id", "m1");
  f.set("backup_only", "1");
  f.set("sys_parts", JSON.stringify(files.map((name, i) => ({ name, offset: i * 600 }))));
  for (const name of files) f.set(name, new File([new Uint8Array([1, 2, 3])], `${name}.m4a`));
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

Deno.test("ЯДРО: бэкап принимает держатель и любой из recorders; чужой — нет", () => {
  assertEquals(mayBackup(MEETING, 10), true);
  assertEquals(mayBackup(MEETING, 20), true);
  assertEquals(mayBackup(MEETING, 30), false);
  assertEquals(mayBackup({ claim_owner: null, recorders: null }, 30), false);
});

Deno.test("причина: неизвестное и пустое — other; числа формы — границы и мусор", () => {
  assertEquals(parseBackupReason("deferred"), "deferred");
  assertEquals(parseBackupReason("rejected"), "rejected");
  assertEquals(parseBackupReason("whatever"), "other");
  assertEquals(parseBackupReason(null), "other");
  assertEquals(parseOptionalNumber(null, "mic_start_offset", { value: 0, inclusive: true }), null);
  assertEquals(parseOptionalNumber("0", "mic_start_offset", { value: 0, inclusive: true }), 0);
  assertEquals(parseOptionalNumber("12.5", "recorded_seconds", { value: 0, inclusive: false }), 12.5);
  for (const bad of ["-1", "abc"]) {
    try {
      parseOptionalNumber(bad, "mic_start_offset", { value: 0, inclusive: true });
      assert(false, `${bad} должен отбиваться`);
    } catch (e) {
      assertEquals((e as Error).constructor.name, "BackupInputError");
    }
  }
});

Deno.test("путь части: под backup/<встреча>/, источник без двоеточий", () => {
  assertEquals(backupPartPath("m1", "agent:x:5", "u", "sys", "a b.m4a"), "backup/m1/agent_x_5/u/sys-a_b.m4a");
});

Deno.test("ЯДРО: бэкап записывает части и строку; строка встречи и распознавание не затрагиваются", async () => {
  const db = fakeBackupDb();
  const res = await handleBackupUpload(
    db.client,
    MEETING,
    20,
    SOURCE,
    form({ reason: "rejected", recorded_seconds: "300", mic_start_offset: "1.5" }, ["a", "b"]),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true);
  assert(typeof body.backup_id === "string" && typeof body.expires_at === "string");
  assertEquals(db.rows.length, 1);
  const row = db.rows[0];
  assertEquals([row.reason, row.uploader, row.source, row.group_id], ["rejected", 20, SOURCE, "g"]);
  assertEquals([row.recorded_seconds, row.mic_start_offset], [300, 1.5]);
  assertEquals(db.files.size, 2);
  assert([...db.files].every((p) => p.startsWith("backup/m1/")));
  assertEquals(row.parts.length, 2);
});

Deno.test("ЯДРО: чужой — 403 и ничего не записано", async () => {
  const db = fakeBackupDb();
  const res = await handleBackupUpload(db.client, MEETING, 30, "person:30", form());
  assertEquals(res.status, 403);
  assertEquals([db.rows.length, db.files.size], [0, 0]);
});

Deno.test("плохой ввод — 400 до записи; пустая запись — 400; неверная причина → other", async () => {
  const db = fakeBackupDb();
  assertEquals((await handleBackupUpload(db.client, MEETING, 20, SOURCE, form({ recorded_seconds: "0" }))).status, 400);
  assertEquals(
    (await handleBackupUpload(db.client, MEETING, 20, SOURCE, form({ mic_start_offset: "-3" }))).status,
    400,
  );
  const empty = new FormData();
  empty.set("meeting_id", "m1");
  assertEquals((await handleBackupUpload(db.client, MEETING, 20, SOURCE, empty)).status, 400);
  assertEquals([db.rows.length, db.files.size], [0, 0]);
  assertEquals((await handleBackupUpload(db.client, MEETING, 20, SOURCE, form({ reason: "zzz" }))).status, 200);
  assertEquals(db.rows[0].reason, "other");
});

Deno.test("ЯДРО: повтор от того же источника заменяет прежний бэкап; старые файлы убираются после записи нового", async () => {
  const db = fakeBackupDb();
  await handleBackupUpload(db.client, MEETING, 20, SOURCE, form({}, ["a"]));
  const oldPaths = [...db.files];
  const res = await handleBackupUpload(db.client, MEETING, 20, SOURCE, form({}, ["b"]));
  assertEquals(res.status, 200);
  assertEquals(db.rows.length, 2);
  assert(db.rows[0].replaced_at !== null && db.rows[0].purged_at !== null, "прежний замещён и убран");
  assertEquals(db.rows[1].replaced_at, null);
  assertEquals(oldPaths.some((p) => db.files.has(p)), false, "старые файлы удалены");
  assertEquals(db.files.size, 1);
  // Другой источник той же встречи живёт отдельно.
  await handleBackupUpload(db.client, MEETING, 10, "person:10", form({}, ["c"]));
  assertEquals(db.files.size, 2);
});

Deno.test("ЯДРО: сбой записи строки — прежний бэкап цел и жив, новые файлы убраны", async () => {
  const db = fakeBackupDb();
  await handleBackupUpload(db.client, MEETING, 20, SOURCE, form({}, ["a"]));
  const oldPaths = [...db.files];
  db.failInsert = {};
  const res = await handleBackupUpload(db.client, MEETING, 20, SOURCE, form({}, ["b"]));
  assertEquals(res.status, 500);
  assertEquals(db.rows.length, 1);
  assertEquals(db.rows[0].replaced_at, null, "прежний возвращён в строй");
  assertEquals([...db.files], oldPaths, "новые файлы убраны, старые на месте");
  // Гонка двух выгрузок: уникальный индекс — 409, а не 500.
  db.failInsert = { code: "23505" };
  assertEquals((await handleBackupUpload(db.client, MEETING, 20, SOURCE, form({}, ["c"]))).status, 409);
});

Deno.test("сбой хранилища при заливке — 500, ни строки, ни частичных файлов", async () => {
  const db = fakeBackupDb();
  db.failUpload.add("sys-b.m4a");
  const res = await handleBackupUpload(db.client, MEETING, 20, SOURCE, form({}, ["a", "b"]));
  assertEquals(res.status, 500);
  assertEquals([db.rows.length, db.files.size], [0, 0]);
});

Deno.test("сбой удаления старых файлов не рушит ответ: прежний замещён, уборка повторит", async () => {
  const db = fakeBackupDb();
  await handleBackupUpload(db.client, MEETING, 20, SOURCE, form({}, ["a"]));
  db.failRemove.add(db.rows[0].parts[0].path);
  const res = await handleBackupUpload(db.client, MEETING, 20, SOURCE, form({}, ["b"]));
  assertEquals(res.status, 200);
  assertEquals([db.rows[0].replaced_at !== null, db.rows[0].purged_at], [true, null]);
});
