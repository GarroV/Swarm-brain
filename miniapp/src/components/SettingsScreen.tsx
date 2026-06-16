"use client";
import { useState, useEffect } from "react";
import {
  fetchMe, patchMe, fetchConfig, fetchIntegrations, connectGranola, disconnectGranola,
  googleConnectUrl, disconnectGoogle,
  fetchGranolaUnprocessed, previewGranolaNote, importGranolaNote, skipGranolaNote,
  sendFeedback, generateDigest, uploadFile, logout,
} from "@/lib/api";
import { getInitData } from "@/lib/telegram";
import { countryName } from "@/lib/countries";
import type { Me, Integration, GranolaNote } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, CheckCircle, Wifi, WifiOff, Loader2 } from "lucide-react";

// ── Profile section ───────────────────────────────────────────────────────────

function ProfileSection({ me }: { me: Me }) {
  const [role, setRole] = useState<string | null>(me.role);
  const [markets, setMarkets] = useState<string[]>(me.markets);
  const [allowedMarkets, setAllowedMarkets] = useState<string[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchConfig()
      .then(c => setAllowedMarkets(c.allowed_markets))
      .finally(() => setMarketsLoading(false));
  }, []);

  const toggleMarket = (m: string) => {
    setMarkets((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await patchMe({ role: role || null, markets });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs text-muted-foreground">Имя</Label>
        <p className="text-sm font-medium mt-0.5">{me.name}</p>
        {me.username && (
          <p className="text-xs text-muted-foreground mt-0.5">@{me.username}</p>
        )}
      </div>
      <div>
        <Label htmlFor="role" className="text-xs">Роль</Label>
        <Select value={role ?? ""} onValueChange={(v) => setRole(v || null)}>
          <SelectTrigger id="role" className="mt-1">
            <SelectValue placeholder="Выбрать роль" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bd">BD</SelectItem>
            <SelectItem value="marketing">Marketing</SelectItem>
            <SelectItem value="rnd">R&D</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Рынки</Label>
        {marketsLoading ? (
          <p className="text-xs text-muted-foreground mt-2">Загрузка…</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {allowedMarkets.map((code) => (
              <button
                key={code}
                onClick={() => toggleMarket(code)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${markets.includes(code) ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground border-border"}`}
              >
                {countryName(code)}
              </button>
            ))}
          </div>
        )}
      </div>
      <Button size="sm" onClick={handleSave} disabled={saving} className="w-full">
        {saving ? "Сохраняю…" : saved ? "✓ Сохранено" : "Сохранить"}
      </Button>
    </div>
  );
}

// ── Granola note preview modal ────────────────────────────────────────────────

function GranolaNoteModal({
  note, onClose, onImported, onSkipped,
}: {
  note: GranolaNote; onClose: () => void; onImported: () => void; onSkipped: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  const noteDate = note.calendar_event?.scheduled_start_time ?? note.created_at;

  const loadPreview = async () => {
    setLoadingPreview(true);
    try {
      const { summary } = await previewGranolaNote(note.id);
      setPreview(summary);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleImport = async (visibility: "public" | "private") => {
    setSaving(true);
    try {
      await importGranolaNote(note.id, visibility);
      onImported();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    await skipGranolaNote(note.id);
    onSkipped();
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base leading-snug">{note.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {new Date(noteDate).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
          {note.attendees && note.attendees.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Участники: {note.attendees.map((a) => a.name ?? a.email).filter(Boolean).join(", ")}
            </p>
          )}

          {!preview ? (
            <Button size="sm" variant="secondary" onClick={loadPreview} disabled={loadingPreview} className="w-full">
              {loadingPreview ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Генерирую тезисы…</> : "Посмотреть тезисы (GPT)"}
            </Button>
          ) : (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Тезисы</p>
              <p className="text-sm whitespace-pre-wrap">{preview}</p>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Button size="sm" onClick={() => handleImport("public")} disabled={saving} className="w-full">
              Сохранить в базу (общее)
            </Button>
            <Button size="sm" variant="secondary" onClick={() => handleImport("private")} disabled={saving} className="w-full">
              Сохранить (личное 🔒)
            </Button>
            <Button size="sm" variant="ghost" onClick={handleSkip} className="w-full text-muted-foreground">
              Пропустить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Granola section ───────────────────────────────────────────────────────────

function GranolaSection() {
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [notes, setNotes] = useState<GranolaNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [selectedNote, setSelectedNote] = useState<GranolaNote | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetchIntegrations()
      .then((list) => setIntegration(list.find((i) => i.service === "granola") ?? null))
      .finally(() => setLoading(false));
  }, []);

  const loadNotes = async () => {
    setNotesLoading(true);
    try { setNotes(await fetchGranolaUnprocessed("7d")); }
    finally { setNotesLoading(false); }
  };

  useEffect(() => {
    if (integration) loadNotes();
  }, [integration]);

  const handleConnect = async () => {
    if (!apiKey.trim()) return;
    setConnecting(true);
    try {
      await connectGranola(apiKey.trim());
      setIntegration({ service: "granola", last_polled_at: null, skipped_note_ids: [] });
      setShowForm(false);
      setApiKey("");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm("Отключить Granola?")) return;
    await disconnectGranola();
    setIntegration(null);
    setNotes([]);
  };

  if (loading) return <p className="text-sm text-muted-foreground">Загрузка…</p>;

  if (!integration) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <WifiOff className="w-4 h-4 text-muted-foreground" />
          <span className="text-muted-foreground">Granola не подключена</span>
        </div>
        {!showForm ? (
          <Button size="sm" variant="outline" onClick={() => setShowForm(true)} className="w-full">
            Подключить Granola
          </Button>
        ) : (
          <div className="space-y-2">
            <Input
              placeholder="Granola API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="text-sm"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleConnect} disabled={connecting || !apiKey.trim()} className="flex-1">
                {connecting ? "Подключаю…" : "Подключить"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Отмена</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Wifi className="w-4 h-4 text-green-500" />
          <span>Granola подключена</span>
        </div>
        <button onClick={handleDisconnect} className="text-xs text-muted-foreground hover:text-destructive">
          Отключить
        </button>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">Необработанные заметки</p>
          <button onClick={loadNotes} className="text-xs text-primary">Обновить</button>
        </div>
        {notesLoading ? (
          <p className="text-xs text-muted-foreground">Загрузка…</p>
        ) : notes.length === 0 ? (
          <p className="text-xs text-muted-foreground">Нет новых заметок</p>
        ) : (
          <div className="space-y-2">
            {notes.map((n) => {
              const d = n.calendar_event?.scheduled_start_time ?? n.created_at;
              return (
                <button
                  key={n.id}
                  onClick={() => setSelectedNote(n)}
                  className="w-full text-left p-2.5 rounded-lg border bg-card"
                >
                  <p className="text-sm font-medium line-clamp-1">{n.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(d).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedNote && (
        <GranolaNoteModal
          note={selectedNote}
          onClose={() => setSelectedNote(null)}
          onImported={loadNotes}
          onSkipped={loadNotes}
        />
      )}
    </div>
  );
}

// ── Digest section ────────────────────────────────────────────────────────────

function DigestSection() {
  const [days, setDays] = useState(7);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setResult(null);
    try {
      const { text } = await generateDigest(days);
      setResult(text);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label className="text-sm">Период:</Label>
        {([7, 14, 30] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${days === d ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground"}`}
          >
            {d}д
          </button>
        ))}
      </div>
      <Button onClick={handleGenerate} disabled={generating} className="w-full">
        {generating ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Генерирую (~10 сек)…</> : "Сгенерировать дайджест"}
      </Button>
      {result && (
        <div className="p-3 rounded-lg border bg-muted/50">
          <p className="text-sm whitespace-pre-wrap">{result}</p>
        </div>
      )}
    </div>
  );
}

// ── Upload section ────────────────────────────────────────────────────────────

function UploadSection() {
  const [file, setFile] = useState<File | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      await uploadFile(file, isPrivate);
      setDone(true);
      setFile(null);
      setTimeout(() => setDone(false), 3000);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <input
        type="file"
        accept=".pdf,.xlsx,.xls,.docx,.txt"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="text-sm w-full"
      />
      {file && (
        <>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            Личный файл (только я вижу)
          </label>
          <Button onClick={handleUpload} disabled={uploading} className="w-full">
            {uploading ? "Загружаю…" : `Загрузить ${file.name}`}
          </Button>
        </>
      )}
      {done && <p className="text-sm text-green-600">✓ Файл загружен в базу знаний</p>}
    </div>
  );
}

// ── Feedback section ──────────────────────────────────────────────────────────

function FeedbackSection() {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await sendFeedback(text.trim());
      setText("");
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <Textarea
        placeholder="Опишите проблему или предложение…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="text-sm min-h-[100px]"
      />
      <Button onClick={handleSend} disabled={sending || !text.trim()} className="w-full">
        {sending ? "Отправляю…" : sent ? "✓ Отправлено" : "Отправить"}
      </Button>
    </div>
  );
}

// ── Collapsible section wrapper ───────────────────────────────────────────────

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 text-sm font-medium"
        onClick={() => setOpen((v) => !v)}
      >
        {title}
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>
      {open && <div className="px-4 py-3">{children}</div>}
    </div>
  );
}

// ── Account section ───────────────────────────────────────────────────────────

// Браузерная сессия (httpOnly cookie). Внутри Telegram Mini App initData непустой —
// там аккаунт определяется тем, кто открыл бота, сменить его из приложения нельзя.
function AccountSection() {
  const [busy, setBusy] = useState(false);

  const handleLogout = async () => {
    if (!window.confirm("Выйти и войти под другим аккаунтом?")) return;
    setBusy(true);
    try {
      await logout();
      window.location.href = "/login";
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Завершить сессию в браузере. После выхода — вход через Telegram (можно другим аккаунтом).
      </p>
      <Button size="sm" variant="outline" onClick={handleLogout} disabled={busy} className="w-full">
        {busy ? "Выхожу…" : "Выйти / сменить аккаунт"}
      </Button>
    </div>
  );
}

// ── Google Calendar section ────────────────────────────────────────────────────

function GoogleCalendarSection() {
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    fetchIntegrations()
      .then((l) => setConnected(l.some((i) => i.service === "google_calendar")))
      .catch(() => setConnected(false));
  }, []);
  const connect = async () => {
    const url = await googleConnectUrl();
    const tg = (window as unknown as { Telegram?: { WebApp?: { openLink?: (u: string) => void } } }).Telegram?.WebApp;
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, "_blank");
  };
  const disconnect = async () => {
    if (!window.confirm("Отключить Google-календарь?")) return;
    await disconnectGoogle();
    setConnected(false);
  };
  if (connected === null) return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Чтобы рекордер сам определял встречу (название, участники, дедуп между записавшими) — подключи Google-календарь. Доступ только на чтение событий.
      </p>
      {connected ? (
        <div className="flex items-center gap-3">
          <span className="text-sm text-green-600">✓ Подключён</span>
          <Button variant="outline" size="sm" onClick={disconnect}>Отключить</Button>
        </div>
      ) : (
        <Button onClick={connect}>Подключить Google-календарь</Button>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function SettingsScreen() {
  const [me, setMe] = useState<Me | null>(null);
  // В браузере getInitData() пустой → показываем выход; внутри Telegram — нет.
  const isWebSession = !getInitData();

  useEffect(() => { fetchMe().then(setMe).catch(() => {}); }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-5 pb-3">
        <h1 className="text-xl font-semibold">Настройки</h1>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        <Section title="👤 Профиль" defaultOpen>
          {me ? <ProfileSection me={me} /> : <p className="text-sm text-muted-foreground">Загрузка…</p>}
        </Section>
        <Section title="🟣 Granola">
          <GranolaSection />
        </Section>
        <Section title="📅 Google-календарь">
          <GoogleCalendarSection />
        </Section>
        <Section title="📋 Дайджест">
          <DigestSection />
        </Section>
        <Section title="📎 Загрузить файл">
          <UploadSection />
        </Section>
        <Section title="💬 Фидбек">
          <FeedbackSection />
        </Section>
        {isWebSession && (
          <Section title="🚪 Аккаунт">
            <AccountSection />
          </Section>
        )}
      </div>
    </div>
  );
}
