import type { SwarmNotification } from "./notificationTypes";
import type { DeployNotice } from "./deployNotice";

type Snapshot = { items: SwarmNotification[]; unread: number };
type Response = Snapshot & { notice?: DeployNotice | null };

/** Shared read state for all bells; API transport and the polling lifetime live outside. */
export function createNotificationFeed({
  load,
  read,
  onLoaded,
  onRead,
}: {
  load: () => Promise<Response>;
  read: (ids?: string[]) => Promise<void>;
  onLoaded?: (response: Response) => void;
  onRead?: (unread: number) => void;
}) {
  let snapshot: Snapshot = { items: [], unread: 0 };
  const listeners = new Set<() => void>();
  let pending: Promise<void> | null = null;
  let requestId = 0;
  let writes = 0;

  const update = (next: Snapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const refresh = (force = false): Promise<void> => {
    if (pending && !force) return pending;
    const id = ++requestId;
    const request = Promise.resolve().then(load).then((response) => {
      // A response issued before a read must not restore its stale unread count.
      if (id !== requestId || writes > 0) return;
      update({ items: response.items, unread: response.unread });
      onLoaded?.(response);
    }).catch(() => {
      // Retain the last snapshot on transient failure, as the bell did before.
    }).finally(() => {
      if (pending === request) pending = null;
    });
    pending = request;
    return request;
  };

  const markRead = async (ids?: string[]): Promise<void> => {
    const wanted = ids ? new Set(ids) : null;
    const changed = snapshot.items.filter((item) =>
      !item.read_at && (!wanted || wanted.has(item.id))
    );
    if (wanted ? changed.length === 0 : snapshot.unread === 0) return;
    const decrement = wanted ? changed.length : snapshot.unread;
    writes++;
    requestId++;
    const now = new Date().toISOString();
    update({
      items: snapshot.items.map((item) =>
        !item.read_at && (!wanted || wanted.has(item.id))
          ? { ...item, read_at: now }
          : item
      ),
      unread: wanted ? Math.max(0, snapshot.unread - changed.length) : 0,
    });
    onRead?.(snapshot.unread);
    let failed = false;
    let failure: unknown;
    try {
      await read(ids);
    } catch (error) {
      failed = true;
      failure = error;
      const previous = new Map(changed.map((item) => [item.id, item]));
      update({
        items: snapshot.items.map((item) => previous.get(item.id) ?? item),
        unread: snapshot.unread + decrement,
      });
      onRead?.(snapshot.unread);
    } finally {
      writes--;
      // Reconcile once after overlapping reads, on success as well as failure.
      if (writes === 0) await refresh(true);
    }
    if (failed) throw failure;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    markRead,
  };
}
