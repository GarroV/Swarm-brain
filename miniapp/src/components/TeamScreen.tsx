"use client";
import { useState, useEffect } from "react";
import { fetchUsers } from "@/lib/api";
import type { User } from "@/types";
import { Badge } from "@/components/ui/badge";

function Initials({ name }: { name: string }) {
  const isId = /^\d+$/.test(name);
  const parts = isId ? ["#"] : name.trim().split(" ");
  const letters = isId ? "#" : parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
  return (
    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold text-sm shrink-0 uppercase">
      {letters}
    </div>
  );
}

const ROLE_LABELS: Record<string, string> = {
  marketing: "Marketing",
  bd: "BD",
  rnd: "R&D",
};

export function TeamScreen() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsers()
      .then(setUsers)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold">Команда</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {loading ? (
          <p className="text-center text-muted-foreground py-8 text-sm">Загрузка…</p>
        ) : users.length === 0 ? (
          <p className="text-center text-muted-foreground py-8 text-sm">Нет участников</p>
        ) : (
          users.map((u) => (
            <div key={u.telegram_id} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
              <Initials name={u.name} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{/^\d+$/.test(u.name) ? `#${u.name}` : u.name}</p>
                {u.username && (
                  <p className="text-xs text-muted-foreground">@{u.username}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                {u.role && (
                  <Badge variant="outline" className="text-xs">
                    {ROLE_LABELS[u.role] ?? u.role}
                  </Badge>
                )}
                {u.markets.length > 0 && (
                  <span className="text-xs text-muted-foreground">{u.markets.join(", ")}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
