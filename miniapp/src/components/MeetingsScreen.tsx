"use client";
import { useState, useEffect, useCallback } from "react";
import { fetchMeetings, patchMeeting, deleteMeeting } from "@/lib/api";
import type { Entry } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, Clock } from "lucide-react";

const SOURCE_LABEL: Record<string, string> = { granola: "Granola", read_ai: "Read.ai" };

function meetingTitle(m: Entry): string {
  if (typeof m.metadata.title === "string" && m.metadata.title) return m.metadata.title;
  if (m.summary) return m.summary.split("\n")[0].slice(0, 60);
  return m.content.slice(0, 60);
}

function meetingDate(m: Entry): string {
  const raw = (m.metadata as Record<string, unknown>).entry_date as string | undefined
    ?? m.entry_date ?? m.created_at.slice(0, 10);
  return raw.slice(0, 10);
}

function MeetingCard({ meeting, onTap }: { meeting: Entry; onTap: () => void }) {
  const confirmed = Boolean(meeting.metadata.confirmed);
  return (
    <button className="w-full text-left p-3 rounded-lg border bg-card space-y-1.5" onClick={onTap}>
      <div className="flex items-start gap-2">
        <p className="flex-1 text-sm font-medium leading-snug line-clamp-2">{meetingTitle(meeting)}</p>
        {confirmed
          ? <CheckCircle className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
          : <Clock className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />}
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="text-xs">{SOURCE_LABEL[meeting.source] ?? meeting.source}</Badge>
        {meeting.countries.slice(0, 2).map((c) => (
          <span key={c} className="text-xs text-muted-foreground">{c}</span>
        ))}
        <span className="text-xs text-muted-foreground ml-auto">{meetingDate(meeting)}</span>
      </div>
    </button>
  );
}

function MeetingDetailDialog({
  meeting, onClose, onUpdated,
}: {
  meeting: Entry; onClose: () => void; onUpdated: () => void;
}) {
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryText, setSummaryText] = useState(meeting.summary ?? "");
  const [saving, setSaving] = useState(false);

  const confirmed = Boolean(meeting.metadata.confirmed);

  const handleConfirm = async () => {
    setSaving(true);
    try { await patchMeeting(meeting.id, { confirmed: true }); onUpdated(); onClose(); }
    finally { setSaving(false); }
  };

  const handleSaveSummary = async () => {
    setSaving(true);
    try { await patchMeeting(meeting.id, { summary: summaryText }); onUpdated(); setEditingSummary(false); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!window.confirm("Удалить встречу?")) return;
    await deleteMeeting(meeting.id);
    onUpdated();
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{meetingTitle(meeting)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{SOURCE_LABEL[meeting.source] ?? meeting.source}</Badge>
            <span>{meetingDate(meeting)}</span>
            {confirmed
              ? <span className="text-green-600 font-medium">✓ Подтверждена</span>
              : <span className="text-amber-600">⏳ Не подтверждена</span>}
          </div>

          {editingSummary ? (
            <div className="space-y-2">
              <Textarea
                value={summaryText}
                onChange={(e) => setSummaryText(e.target.value)}
                className="min-h-[140px] text-sm"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSaveSummary} disabled={saving} className="flex-1">
                  {saving ? "…" : "Сохранить"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditingSummary(false)}>Отмена</Button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground">Тезисы</p>
                <button onClick={() => setEditingSummary(true)} className="text-xs text-primary">Редактировать</button>
              </div>
              <p className="text-sm whitespace-pre-wrap">{meeting.summary ?? "—"}</p>
            </div>
          )}

          {meeting.content && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Содержимое</p>
              <p className="text-sm whitespace-pre-wrap line-clamp-6">{meeting.content}</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            {!confirmed && (
              <Button size="sm" onClick={handleConfirm} disabled={saving} className="flex-1">
                ✓ Подтвердить
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={handleDelete}>
              Удалить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MeetingsScreen() {
  const [all, setAll] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "pending" | "confirmed">("all");
  const [selected, setSelected] = useState<Entry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setAll(await fetchMeetings()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = tab === "all" ? all
    : tab === "pending" ? all.filter((m) => !m.metadata.confirmed)
    : all.filter((m) => Boolean(m.metadata.confirmed));

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold">Встречи</h1>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex-1 flex flex-col">
        <TabsList className="mx-4 grid grid-cols-3">
          <TabsTrigger value="all">Все</TabsTrigger>
          <TabsTrigger value="pending">Ожидают</TabsTrigger>
          <TabsTrigger value="confirmed">Подтверждены</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 mt-0">
          {loading ? (
            <p className="text-center text-muted-foreground py-8 text-sm">Загрузка…</p>
          ) : visible.length === 0 ? (
            <p className="text-center text-muted-foreground py-8 text-sm">Нет встреч</p>
          ) : (
            visible.map((m) => (
              <MeetingCard key={m.id} meeting={m} onTap={() => setSelected(m)} />
            ))
          )}
        </TabsContent>
      </Tabs>

      {selected && (
        <MeetingDetailDialog
          meeting={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => { setSelected(null); load(); }}
        />
      )}
    </div>
  );
}
