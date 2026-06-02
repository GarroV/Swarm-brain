"use client";
import { useState, useEffect, useCallback } from "react";
import { fetchEntries, fetchEntry, searchEntries, patchEntry, deleteEntry, createEntry } from "@/lib/api";
import type { Entry } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Search, Lock, Plus, X } from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  note: "Заметка", transcript: "Транскрипт", meeting: "Встреча",
  document: "Документ", summary: "Саммари",
};

function EntryPreview({ entry }: { entry: Entry }) {
  const text = entry.summary ?? entry.content.slice(0, 100);
  const date = entry.entry_date ?? entry.created_at.slice(0, 10);
  return (
    <div className="p-3 rounded-lg border bg-card space-y-1.5">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-sm font-medium leading-snug line-clamp-2">{text}</p>
        {entry.is_private && <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="text-xs">{TYPE_LABELS[entry.entry_type] ?? entry.entry_type}</Badge>
        {entry.countries.slice(0, 2).map((c) => (
          <span key={c} className="text-xs text-muted-foreground">{c}</span>
        ))}
        <span className="text-xs text-muted-foreground ml-auto">{date}</span>
      </div>
    </div>
  );
}

function EntryDetailDialog({
  entryId, myTelegramId, onClose, onDeleted,
}: {
  entryId: string; myTelegramId: number; onClose: () => void; onDeleted: () => void;
}) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchEntry(entryId).then((e) => { setEntry(e); setEditContent(e.content); });
  }, [entryId]);

  const isOwner = entry?.owner_id === myTelegramId;

  const handleSave = async () => {
    if (!entry) return;
    setSaving(true);
    try {
      const updated = await patchEntry(entry.id, { content: editContent });
      setEntry(updated);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!entry || !window.confirm("Удалить запись?")) return;
    await deleteEntry(entry.id);
    onDeleted();
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {entry ? (TYPE_LABELS[entry.entry_type] ?? entry.entry_type) : "Запись"}
            {entry?.is_private && <Lock className="w-4 h-4 text-muted-foreground" />}
          </DialogTitle>
        </DialogHeader>
        {!entry ? (
          <p className="text-sm text-muted-foreground text-center py-4">Загрузка…</p>
        ) : editing ? (
          <div className="space-y-3">
            <Textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="min-h-[200px] text-sm"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? "Сохраняю…" : "Сохранить"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Отмена</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {entry.summary && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Тезисы</p>
                <p className="text-sm whitespace-pre-wrap">{entry.summary}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground mb-1">Содержимое</p>
              <p className="text-sm whitespace-pre-wrap">{entry.content}</p>
            </div>
            {entry.countries.length > 0 && (
              <p className="text-xs text-muted-foreground">Рынки: {entry.countries.join(", ")}</p>
            )}
            {isOwner && (
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="flex-1">Редактировать</Button>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={handleDelete}>
                  Удалить
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddEntryDialog({ myTelegramId, onClose, onSaved }: { myTelegramId: number; onClose: () => void; onSaved: () => void }) {
  const [content, setContent] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);
  void myTelegramId;

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await createEntry({ content: content.trim(), is_private: isPrivate });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>Добавить запись</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Textarea
            placeholder="Текст записи…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[140px] text-sm"
            autoFocus
          />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            Личная запись (только я вижу)
          </label>
          <Button onClick={handleSave} disabled={saving || !content.trim()} className="w-full">
            {saving ? "Сохраняю…" : "Добавить"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface KnowledgeScreenProps { myTelegramId: number; }

export function KnowledgeScreen({ myTelegramId }: KnowledgeScreenProps) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchEntries();
      setEntries(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const handleSearch = async () => {
    if (!query.trim()) { loadEntries(); return; }
    setSearching(true);
    try {
      const data = await searchEntries(query.trim());
      setEntries(data);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => { setQuery(""); loadEntries(); };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold mb-3">База знаний</h1>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-8 text-sm"
              placeholder="Семантический поиск…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            {query && (
              <button onClick={clearSearch} className="absolute right-2.5 top-2.5">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <Button size="sm" onClick={handleSearch} disabled={searching} variant="secondary" className="shrink-0">
            {searching ? "…" : "Найти"}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {loading ? (
          <p className="text-center text-muted-foreground py-8 text-sm">Загрузка…</p>
        ) : entries.length === 0 ? (
          <p className="text-center text-muted-foreground py-8 text-sm">
            {query ? "Ничего не найдено" : "Нет записей"}
          </p>
        ) : (
          entries.map((e) => (
            <button key={e.id} className="w-full text-left" onClick={() => setSelectedId(e.id)}>
              <EntryPreview entry={e} />
            </button>
          ))
        )}
      </div>

      <div className="px-4 pb-4">
        <Button className="w-full" onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4 mr-1" /> Добавить запись
        </Button>
      </div>

      {selectedId && (
        <EntryDetailDialog
          entryId={selectedId}
          myTelegramId={myTelegramId}
          onClose={() => setSelectedId(null)}
          onDeleted={loadEntries}
        />
      )}

      {showAdd && (
        <AddEntryDialog
          myTelegramId={myTelegramId}
          onClose={() => setShowAdd(false)}
          onSaved={loadEntries}
        />
      )}
    </div>
  );
}
