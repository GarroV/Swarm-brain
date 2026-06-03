"use client";
import { useState, useEffect, useCallback } from "react";
import {
  fetchAdminWorkspaces, fetchAdminWorkspaceUsers,
  addUserToWorkspace, removeUserFromWorkspace, patchAdminWorkspace,
  fetchConfig,
} from "@/lib/api";
import type { AdminWorkspace, AdminUser } from "@/types";
import { countryName, COUNTRY_NAMES } from "@/lib/countries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChevronLeft, Trash2, UserPlus, Loader2 } from "lucide-react";

// ── Workspace list ────────────────────────────────────────────────────────────

function WorkspaceList({ onSelect }: { onSelect: (ws: AdminWorkspace) => void }) {
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAdminWorkspaces().then(setWorkspaces).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-center text-muted-foreground py-8 text-sm">Загрузка…</p>;

  return (
    <div className="space-y-2">
      {workspaces.map((ws) => (
        <button
          key={ws.id}
          onClick={() => onSelect(ws)}
          className="w-full text-left p-3 rounded-lg border bg-card flex items-center justify-between"
        >
          <div>
            <p className="font-medium text-sm">{ws.name}</p>
            <p className="text-xs text-muted-foreground">{ws.id}</p>
          </div>
          <Badge variant="secondary">{ws.user_count} чел.</Badge>
        </button>
      ))}
    </div>
  );
}

// ── Workspace detail — Users tab ──────────────────────────────────────────────

function WorkspaceUsers({ wsId }: { wsId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchAdminWorkspaceUsers(wsId).then(setUsers).finally(() => setLoading(false));
  }, [wsId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    const id = Number(addInput.trim());
    if (!id) return;
    setAdding(true);
    try { await addUserToWorkspace(wsId, id); setAddInput(""); load(); }
    finally { setAdding(false); }
  };

  const handleRemove = async (userId: number) => {
    if (!window.confirm("Удалить пользователя из воркспейса?")) return;
    await removeUserFromWorkspace(wsId, userId);
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          placeholder="Telegram ID"
          value={addInput}
          onChange={(e) => setAddInput(e.target.value)}
          className="text-sm"
          type="number"
        />
        <Button size="sm" onClick={handleAdd} disabled={adding || !addInput.trim()}>
          {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.telegram_id} className="flex items-center gap-2 p-2.5 rounded-lg border bg-card">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{u.name}</p>
                <p className="text-xs text-muted-foreground">
                  {u.username ? `@${u.username} · ` : ""}{u.telegram_id}
                </p>
                {u.role && <p className="text-xs text-muted-foreground">{u.role}</p>}
              </div>
              {u.markets.length > 0 && (
                <span className="text-xs text-muted-foreground">{u.markets.map(countryName).join(", ")}</span>
              )}
              <button onClick={() => handleRemove(u.telegram_id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Workspace detail — Markets tab ────────────────────────────────────────────

function WorkspaceMarkets({ ws, onUpdated }: { ws: AdminWorkspace; onUpdated: () => void }) {
  const allCodes = Object.keys(COUNTRY_NAMES);
  const [selected, setSelected] = useState<string[] | null>(ws.allowed_markets);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const isCustom = selected !== null;

  const toggle = (code: string) => {
    if (!isCustom) return;
    setSelected(prev =>
      (prev ?? allCodes).includes(code)
        ? (prev ?? allCodes).filter(c => c !== code)
        : [...(prev ?? allCodes), code]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await patchAdminWorkspace(ws.id, { allowed_markets: selected });
      setSaved(true);
      onUpdated();
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Режим:</p>
        <div className="flex gap-2">
          <button
            onClick={() => setSelected(null)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${!isCustom ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground"}`}
          >
            Глобальный список
          </button>
          <button
            onClick={() => setSelected(ws.allowed_markets ?? allCodes)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${isCustom ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground"}`}
          >
            Свой список
          </button>
        </div>
      </div>

      {isCustom && (
        <div className="flex flex-wrap gap-1.5">
          {allCodes.map((code) => (
            <button
              key={code}
              onClick={() => toggle(code)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                selected!.includes(code)
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-muted-foreground border-border"
              }`}
            >
              {countryName(code)}
            </button>
          ))}
        </div>
      )}

      {!isCustom && (
        <p className="text-xs text-muted-foreground">Пользователи видят все рынки из глобального списка.</p>
      )}

      <Button size="sm" onClick={handleSave} disabled={saving} className="w-full">
        {saving ? "Сохраняю…" : saved ? "✓ Сохранено" : "Сохранить"}
      </Button>
    </div>
  );
}

// ── Workspace detail screen ───────────────────────────────────────────────────

function WorkspaceDetail({ ws, onBack }: { ws: AdminWorkspace; onBack: () => void }) {
  const [workspace, setWorkspace] = useState(ws);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-5 pb-3 flex items-center gap-2">
        <button onClick={onBack} className="text-muted-foreground">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-semibold">{workspace.name}</h1>
        <span className="text-xs text-muted-foreground ml-auto">{workspace.id}</span>
      </div>

      <Tabs defaultValue="users" className="flex-1 flex flex-col">
        <TabsList className="mx-4 grid grid-cols-2">
          <TabsTrigger value="users">Пользователи</TabsTrigger>
          <TabsTrigger value="markets">Рынки</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="flex-1 overflow-y-auto px-4 py-3 mt-0">
          <WorkspaceUsers wsId={workspace.id} />
        </TabsContent>
        <TabsContent value="markets" className="flex-1 overflow-y-auto px-4 py-3 mt-0">
          <WorkspaceMarkets ws={workspace} onUpdated={() => setWorkspace(w => ({ ...w }))} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function AdminScreen() {
  const [selected, setSelected] = useState<AdminWorkspace | null>(null);

  if (selected) {
    return <WorkspaceDetail ws={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold">Суперадмин</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Воркспейсы и рынки</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <WorkspaceList onSelect={setSelected} />
      </div>
    </div>
  );
}
