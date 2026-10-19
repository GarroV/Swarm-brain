// Жизненный цикл остатков записей на устройстве: дослать при выходе из аккаунта, чистить по сроку.
import { isExpiredRecording, ownedRecordings } from "./logic";
import * as store from "./store";
import { Uploader } from "./uploader";

const LOGOUT_FLUSH_MS = 10_000;

/**
 * Перед выходом (сессия ещё жива): дослать части записей ЭТОГО пользователя, не дольше таймаута.
 * Завершение не зовём — брошенную запись закроет сторож на сервере; недосланное остаётся в
 * IndexedDB под ownerId и никому другому не предлагается. Любая ошибка — молча: выходу не мешаем.
 */
export async function flushOwnLeftovers(ownerId: number, timeoutMs: number = LOGOUT_FLUSH_MS): Promise<void> {
  const uploaders: Uploader[] = [];
  try {
    const waits: Promise<void>[] = [];
    for (const rec of ownedRecordings(await store.listRecordings(), ownerId)) {
      const segments = await store.loadLeftovers(rec.rid);
      if (segments.length === 0) continue;
      waits.push(new Promise<void>((resolve) => {
        const u: Uploader = new Uploader(rec, {
          onChange: () => { if (u.pending.size === 0) resolve(); },
          onServerId: (id) => { void store.putRecording({ ...rec, serverId: id }); },
          onFatal: () => resolve(),
        });
        uploaders.push(u);
        segments.forEach((seg) => u.enqueue(seg));
      }));
    }
    if (waits.length === 0) return;
    await Promise.race([Promise.all(waits), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
  } catch {
    // best effort
  } finally {
    uploaders.forEach((u) => u.dispose());
  }
}

/** При старте приложения: остатки старше срока хранения удаляются у любого владельца. */
export async function purgeExpiredRecordings(nowMs: number = Date.now()): Promise<void> {
  try {
    for (const rec of await store.listRecordings()) {
      if (isExpiredRecording(rec, nowMs)) await store.deleteRecording(rec.rid);
    }
  } catch {
    // следующий старт попробует снова
  }
}
