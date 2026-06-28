"use client";
import { useState, useEffect } from "react";
import { fetchUsers } from "@/lib/api";
import type { User } from "@/types";
import { Avatar } from "@/components/roy/ui";
import { initials } from "@/components/roy/dash/shared";

const ROLE_LABELS: Record<string, string> = {
  marketing: "Marketing",
  bd: "BD",
  rnd: "R&D",
};

// Заголовок не рендерим: в поповере «Ещё» его даёт Segmented-таб «Команда», в мобильном
// push-стеке — NavHeader. Свой h1 раньше дублировал их (двойной заголовок).
export function TeamScreen() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsers().then(setUsers).finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4 pt-4">
        {loading ? (
          <p className="py-8 text-center text-sm text-ink-soft">Загрузка…</p>
        ) : users.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-soft">Нет участников</p>
        ) : (
          users.map((u) => (
            <div key={u.telegram_id} className="flex items-center gap-3 rounded-[14px] border border-line bg-surface px-3 py-2.5 dark:backdrop-blur-sm">
              <Avatar size={38}>{initials(u.name)}</Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-ink" style={{ fontSize: 13.5 }}>
                  {/^\d+$/.test(u.name) ? `#${u.name}` : u.name}
                </p>
                {u.username && <p className="font-mono text-ink-mute" style={{ fontSize: 11 }}>@{u.username}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {u.role && (
                  <span className="rounded-[7px] px-2 py-0.5 font-semibold" style={{ fontSize: 10.5, color: "var(--accent-ink)", background: "var(--accent-soft)" }}>
                    {ROLE_LABELS[u.role] ?? u.role}
                  </span>
                )}
                {u.markets.length > 0 && (
                  <span className="text-ink-soft" style={{ fontSize: 11 }}>{u.markets.join(", ")}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
