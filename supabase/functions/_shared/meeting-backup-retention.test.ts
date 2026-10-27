// Уборка серверных бэкапов (#1070): просроченные и замещённые уходят пачкой, свежие и убранные не
// трогаются, сбой удаления файла не ставит purged_at и не молчит — следующий проход повторит.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type FakeBackupDb, fakeBackupDb } from "./backup-fake.ts";
import { BACKUP_PURGE_BATCH, purgeExpiredBackups } from "./meeting-backup-retention.ts";

const NOW = "2026-10-30T12:00:00.000Z";
const hours = (h: number) => new Date(Date.parse(NOW) + h * 3600_000).toISOString();

function seed(db: FakeBackupDb, id: string, over: Record<string, unknown> = {}): string {
  const path = `backup/m1/${id}/sys-a.m4a`;
  db.files.add(path);
  db.rows.push({
    id,
    meeting_id: "m1",
    source: `person:${id}`,
    parts: [{ path }],
    expires_at: hours(48),
    replaced_at: null,
    purged_at: null,
    ...over,
  });
  return path;
}

Deno.test("ЯДРО: убирает просроченные и замещённые; свежие и уже убранные не трогает", async () => {
  const db = fakeBackupDb();
  const old = seed(db, "old", { expires_at: hours(-1) });
  const replaced = seed(db, "rep", { replaced_at: hours(-2) });
  const fresh = seed(db, "fresh");
  const done = seed(db, "done", { expires_at: hours(-100), purged_at: hours(-90) });
  const res = await purgeExpiredBackups(db.client, NOW);
  assertEquals(res, { purged: 2, failed: 0 });
  assertEquals([db.files.has(old), db.files.has(replaced), db.files.has(fresh), db.files.has(done)], [
    false,
    false,
    true,
    true,
  ]);
  const byId = Object.fromEntries(db.rows.map((r) => [r.id, r.purged_at !== null]));
  assertEquals(byId, { old: true, rep: true, fresh: false, done: true });
  assertEquals(db.rows.length, 4, "строки остаются — архивация вместо удаления");
});

Deno.test("ЯДРО: сбой удаления файла — purged_at не ставится, остальные убираются, повтор доберёт", async () => {
  const db = fakeBackupDb();
  const bad = seed(db, "bad", { expires_at: hours(-3) });
  seed(db, "ok", { expires_at: hours(-2) });
  db.failRemove.add(bad);
  assertEquals(await purgeExpiredBackups(db.client, NOW), { purged: 1, failed: 1 });
  assertEquals(db.rows.find((r) => r.id === "bad")!.purged_at, null);
  db.failRemove.clear();
  assertEquals(await purgeExpiredBackups(db.client, NOW), { purged: 1, failed: 0 });
  assertEquals(db.files.has(bad), false);
});

Deno.test("пачка ограничена: за проход не больше BACKUP_PURGE_BATCH", async () => {
  const db = fakeBackupDb();
  for (let i = 0; i < BACKUP_PURGE_BATCH + 5; i++) {
    seed(db, `b${String(i).padStart(3, "0")}`, { expires_at: hours(-1) });
  }
  assertEquals((await purgeExpiredBackups(db.client, NOW)).purged, BACKUP_PURGE_BATCH);
  assertEquals((await purgeExpiredBackups(db.client, NOW)).purged, 5);
});
