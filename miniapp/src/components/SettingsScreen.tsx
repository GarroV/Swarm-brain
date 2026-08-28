"use client";
import { useState, useEffect } from "react";
import {
  fetchMe, patchMe, fetchConfig, fetchIntegrations, connectGranola, disconnectGranola,
  googleConnectUrl, disconnectGoogle,
  fetchGranolaUnprocessed, previewGranolaNote, importGranolaNote, skipGranolaNote,
  generateDigest, uploadFile, logout,
  fetchRecorderSetup, mintRecorderToken,
  fetchMcpSetup, mintMcpToken, fetchClaudeInstructions,
} from "@/lib/api";
import { getInitData } from "@/lib/telegram";
import { countryCode } from "@/lib/countries";
import type { Me, Integration, GranolaNote } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FeedbackForm } from "@/components/roy/FeedbackForm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm";
import { RoyIcon, type RoyIconName } from "@/components/roy/icons";

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
                {countryCode(code)}
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
              {loadingPreview ? "Генерирую тезисы…" : "Посмотреть тезисы (GPT)"}
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
  const confirm = useConfirm();
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
    if (!(await confirm({ title: "Отключить Granola?", description: "Импорт заметок из Granola остановится. Подключить снова можно в любой момент.", confirmText: "Отключить" }))) return;
    await disconnectGranola();
    setIntegration(null);
    setNotes([]);
  };

  if (loading) return <p className="text-sm text-muted-foreground">Загрузка…</p>;

  if (!integration) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <RoyIcon name="link" size={16} strokeWidth={1.9} className="text-ink-mute" />
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
          <RoyIcon name="link" size={16} strokeWidth={1.9} className="text-status-done" />
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

function DigestSection({ isAdmin }: { isAdmin: boolean }) {
  const [days, setDays] = useState(7);
  const [allCountries, setAllCountries] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Период и охват сохраняются и используются секцией дайджеста на главной (см. dash/PersonalDigest).
  useEffect(() => {
    const v = Number(localStorage.getItem("roy_digest_days"));
    if (v === 14 || v === 30) setDays(v);
    setAllCountries(localStorage.getItem("roy_digest_all_countries") === "1");
  }, []);
  const chooseDays = (d: number) => {
    setDays(d);
    try { localStorage.setItem("roy_digest_days", String(d)); } catch { /* приватный режим */ }
  };
  const toggleAllCountries = () => {
    const v = !allCountries;
    setAllCountries(v);
    try { localStorage.setItem("roy_digest_all_countries", v ? "1" : "0"); } catch { /* приватный режим */ }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setResult(null);
    try {
      const { text } = await generateDigest(days, allCountries);
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
            onClick={() => chooseDays(d)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${days === d ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground"}`}
          >
            {d}д
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-soft">Этот период используется для дайджеста на главной.</p>
      {isAdmin && (
        <button
          type="button"
          onClick={toggleAllCountries}
          className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-line-2"
        >
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors ${allCountries ? "border-primary bg-primary text-primary-foreground" : "border-line-2"}`}>
            {allCountries && <RoyIcon name="check" size={13} strokeWidth={2.4} />}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">Все страны воркспейса</span>
            <span className="block text-xs text-ink-soft">По умолчанию дайджест — по вашим рынкам. Включите, чтобы видеть обзор по всем рынкам команды.</span>
          </span>
        </button>
      )}
      <Button onClick={handleGenerate} disabled={generating} className="w-full">
        {generating ? "Генерирую (~10 сек)…" : "Сгенерировать дайджест"}
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
      {done && <p className="text-sm text-status-done">✓ Файл загружен в базу знаний</p>}
    </div>
  );
}

// ── Feedback section ──────────────────────────────────────────────────────────

function FeedbackSection() {
  return <FeedbackForm />;
}

// ── Collapsible section wrapper ───────────────────────────────────────────────

function Section({ title, icon, children, defaultOpen = false }: { title: string; icon?: RoyIconName; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-line rounded-[14px] overflow-hidden dark:backdrop-blur-sm">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-2 text-sm font-semibold text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2.5">
          {icon && <RoyIcon name={icon} size={16} strokeWidth={1.9} className="text-ink-soft" />}
          {title}
        </span>
        <RoyIcon name="cright" size={15} strokeWidth={2} className={`text-ink-soft transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && <div className="px-4 py-3">{children}</div>}
    </div>
  );
}

// ── Account section ───────────────────────────────────────────────────────────

// Браузерная сессия (httpOnly cookie). Внутри Telegram Mini App initData непустой —
// там аккаунт определяется тем, кто открыл бота, сменить его из приложения нельзя.
function AccountSection() {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  const handleLogout = async () => {
    if (!(await confirm({ title: "Выйти из аккаунта?", description: "Сессия в браузере завершится. Войти снова — через Telegram, можно другим аккаунтом.", confirmText: "Выйти" }))) return;
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
  const confirm = useConfirm();
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
    if (!(await confirm({ title: "Отключить Google-календарь?", description: "bumblebee перестанет предлагать записи по календарю, а тезисы — получать название и участников.", confirmText: "Отключить" }))) return;
    await disconnectGoogle();
    setConnected(false);
  };
  if (connected === null) return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Подключи Google-календарь — bumblebee заранее предложит запись («встреча через N мин»), а тезисы получат название и участников. Доступ только на чтение событий.
      </p>
      {connected ? (
        <div className="flex items-center gap-3">
          <span className="text-sm text-status-done">✓ Подключён</span>
          <Button variant="outline" size="sm" onClick={disconnect}>Отключить</Button>
        </div>
      ) : (
        <Button onClick={connect}>Подключить Google-календарь</Button>
      )}
    </div>
  );
}

// ── Recorder section (Mac) ──────────────────────────────────────────────────────
// Зеркало бот-команды /recordertoken: минт отдельного токена рекордера + однострочник
// установки для Терминала. Токен НЕ Claude-Desktop MCP (/mytoken) — отдельный, на год.

function RecorderSection() {
  const confirm = useConfirm();
  const [setup, setSetup] = useState<{ active: boolean; expiresAt: string | null; updateOneLiner?: string } | null>(null);
  const [oneLiner, setOneLiner] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchRecorderSetup().then(setSetup).catch(() => setSetup({ active: false, expiresAt: null }));
  }, []);

  const getCommand = async (reissue: boolean) => {
    if (reissue && !(await confirm({
      title: "Перевыпустить токен bumblebee?",
      description: "Нужно, только если ты потерял токен или ставишь bumblebee на ДРУГОЙ мак. Для обновления на этом маке токен менять не надо — есть команда выше. Прежний токен после перевыпуска поработает ещё сутки, чтобы записи не потерялись.",
      confirmText: "Перевыпустить",
    }))) return;
    setMinting(true);
    try {
      const { oneLiner: cmd, expiresAt } = await mintRecorderToken();
      setOneLiner(cmd);
      setSetup({ active: true, expiresAt });
    } finally {
      setMinting(false);
    }
  };

  const [copiedUpdate, setCopiedUpdate] = useState(false);

  const copyText = async (text: string, mark: (v: boolean) => void = setCopiedUpdate) => {
    try {
      await navigator.clipboard.writeText(text);
      mark(true);
      setTimeout(() => mark(false), 2000);
    } catch { /* clipboard недоступен — пользователь скопирует вручную */ }
  };

  const copy = () => oneLiner && copyText(oneLiner, setCopied);

  const expStr = setup?.expiresAt
    ? new Date(setup.expiresAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })
    : null;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        bumblebee пишет звук созвона на Mac, сервер делает расшифровку и тезисы — готовая встреча приходит во «Встречи» сама. Токен bumblebee отдельный от Claude Desktop.
      </p>

      {setup?.active && expStr && !oneLiner && (
        <p className="text-sm text-status-done">✓ Подключён · токен действует до {expStr}</p>
      )}

      {/* Уже подключённым почти всегда нужно обновить приложение, а не сменить токен. Эта команда
          идёт БЕЗ токена: установщик возьмёт прописанный на маке, поэтому брошенная на полпути
          установка ничего не ломает. Перевыпуск ниже — для потери токена и другого мака. */}
      {setup?.active && setup.updateOneLiner && !oneLiner && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Обновить bumblebee на этом маке — вставь в Терминал (токен менять не нужно):</p>
          <div className="rounded-lg border bg-muted/50 p-2.5">
            <code className="block break-all text-xs">{setup.updateOneLiner}</code>
          </div>
          <Button size="sm" variant="secondary" onClick={() => copyText(setup.updateOneLiner!)} className="w-full">
            {copiedUpdate ? "✓ Скопировано" : "Скопировать команду обновления"}
          </Button>
        </div>
      )}

      {!oneLiner ? (
        <Button size="sm" variant={setup?.active ? "ghost" : "default"} onClick={() => getCommand(setup?.active ?? false)} disabled={minting || setup === null} className="w-full">
          {minting ? "Готовлю…" : setup?.active ? "Перевыпустить токен (потерял / другой мак)" : "Получить команду установки"}
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">1. Открой Терминал (⌘+Пробел → «Терминал»), вставь строку и нажми Enter:</p>
          <div className="rounded-lg border bg-muted/50 p-2.5">
            <code className="block break-all text-xs">{oneLiner}</code>
          </div>
          <Button size="sm" variant="secondary" onClick={copy} className="w-full">
            {copied ? "✓ Скопировано" : "Скопировать команду"}
          </Button>
          <p className="text-xs text-muted-foreground">2. Скрипт поставит приложение и откроет его.</p>
          <p className="text-xs text-muted-foreground">
            3. Выдай разрешение: <b>System Settings → Privacy &amp; Security → Screen &amp; System Audio Recording</b> → включи bumblebee → перезапусти (⌘Q и открой заново).
          </p>
          <p className="text-xs text-muted-foreground">
            Токен личный, никому не пересылай. Для авто-предложения записи нужен подключённый Google-календарь (секция выше).
          </p>
        </div>
      )}
    </div>
  );
}

// ── Claude Desktop section ──────────────────────────────────────────────────────
// Зеркало бот-команды /setup: минт MCP-токена (Claude Desktop) + однострочник установки.
// Токен отдельный от рекордера, бессрочный.

function ClaudeDesktopSection() {
  const confirm = useConfirm();
  const [active, setActive] = useState<boolean | null>(null);
  const [oneLiner, setOneLiner] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [copied, setCopied] = useState(false);
  // Инструкции для проекта Claude Desktop (зеркало /claude): грузятся по клику, сразу в буфер.
  const [instructions, setInstructions] = useState<string | null>(null);
  const [loadingInstr, setLoadingInstr] = useState(false);
  const [copiedInstr, setCopiedInstr] = useState(false);

  useEffect(() => {
    fetchMcpSetup().then((s) => setActive(s.active)).catch(() => setActive(false));
  }, []);

  const getInstructions = async () => {
    setLoadingInstr(true);
    try {
      const { instructions: text } = await fetchClaudeInstructions();
      setInstructions(text);
      try {
        await navigator.clipboard.writeText(text);
        setCopiedInstr(true);
        setTimeout(() => setCopiedInstr(false), 2000);
      } catch { /* clipboard недоступен — пользователь скопирует из блока ниже вручную */ }
    } finally {
      setLoadingInstr(false);
    }
  };

  const getCommand = async (reissue: boolean) => {
    if (reissue && !(await confirm({ title: "Перевыпустить токен Claude Desktop?", description: "Старый конфиг перестанет работать — переустанови командой ниже.", confirmText: "Перевыпустить" }))) return;
    setMinting(true);
    try {
      const { oneLiner: cmd } = await mintMcpToken();
      setOneLiner(cmd);
      setActive(true);
    } finally {
      setMinting(false);
    }
  };

  const copy = async () => {
    if (!oneLiner) return;
    try {
      await navigator.clipboard.writeText(oneLiner);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard недоступен */ }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Claude Desktop получает доступ к базе знаний, встречам и задачам — ищет и отвечает по делу прямо на твоём Mac. Токен отдельный от bumblebee, бессрочный.
      </p>

      {active && !oneLiner && <p className="text-sm text-status-done">✓ Подключён</p>}

      {!oneLiner ? (
        <Button size="sm" onClick={() => getCommand(active ?? false)} disabled={minting || active === null} className="w-full">
          {minting ? "Готовлю…" : active ? "Перевыпустить команду установки" : "Получить команду установки"}
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">1. Открой Терминал (⌘+Пробел → «Терминал»), вставь строку и нажми Enter:</p>
          <div className="rounded-lg border bg-muted/50 p-2.5">
            <code className="block break-all text-xs">{oneLiner}</code>
          </div>
          <Button size="sm" variant="secondary" onClick={copy} className="w-full">
            {copied ? "✓ Скопировано" : "Скопировать команду"}
          </Button>
          <p className="text-xs text-muted-foreground">2. Скрипт пропишет коннектор и перезапустит Claude Desktop. Ничего скачивать не нужно — Node и npm больше не требуются.</p>
          <p className="text-xs text-muted-foreground">3. В Claude Desktop появится сервер <b>swarm-brain</b> с инструментами. Токен личный — никому не пересылай.</p>
        </div>
      )}

      <div className="space-y-2 border-t pt-3">
        <p className="text-xs text-muted-foreground">
          После установки в Claude Desktop: <b>Projects → New Project</b> → вставь эти инструкции в поле <b>Instructions</b>. Claude будет искать и сохранять по правилам команды.
        </p>
        <Button size="sm" variant="secondary" onClick={getInstructions} disabled={loadingInstr} className="w-full">
          {loadingInstr ? "Готовлю…" : copiedInstr ? "✓ Скопировано" : instructions ? "Скопировать ещё раз" : "Инструкции для проекта"}
        </Button>
        {instructions && (
          <div className="max-h-40 overflow-y-auto rounded-lg border bg-muted/50 p-2.5">
            <code className="block whitespace-pre-wrap break-words text-xs">{instructions}</code>
          </div>
        )}
      </div>
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4 space-y-3">
        <Section icon="team" title="Профиль">
          {me ? <ProfileSection me={me} /> : <p className="text-sm text-muted-foreground">Загрузка…</p>}
        </Section>
        <Section icon="doc" title="Granola">
          <GranolaSection />
        </Section>
        <Section icon="cal" title="Google-календарь">
          <GoogleCalendarSection />
        </Section>
        <Section icon="mic" title="bumblebee — запись встреч (Mac)">
          <RecorderSection />
        </Section>
        <Section icon="spark" title="Claude Desktop">
          <ClaudeDesktopSection />
        </Section>
        <Section icon="note" title="Дайджест">
          <DigestSection isAdmin={!!me?.is_admin} />
        </Section>
        <Section icon="doc" title="Загрузить файл">
          <UploadSection />
        </Section>
        <Section icon="note" title="Фидбек">
          <FeedbackSection />
        </Section>
        {isWebSession && (
          <Section icon="home" title="Аккаунт">
            <AccountSection />
          </Section>
        )}
      </div>
    </div>
  );
}
