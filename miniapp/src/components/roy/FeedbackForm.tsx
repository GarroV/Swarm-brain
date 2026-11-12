"use client";
import { useState } from "react";
import { useDt } from "@/components/roy/nav";
import { sendFeedback } from "@/lib/api";
import { FEEDBACK_CATEGORIES, type FeedbackCategoryCode } from "@/lib/feedbackCategories";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const FEEDBACK_COPY = {
  section: { ru: "Раздел", en: "Section" },
  placeholder: { ru: "Опишите проблему или предложение…", en: "Describe the problem or suggestion…" },
  screenshot: { ru: "Скриншот (необязательно)", en: "Screenshot (optional)" },
  sending: { ru: "Отправляю…", en: "Sending…" },
  sent: { ru: "✓ Отправлено", en: "✓ Sent" },
  send: { ru: "Отправить", en: "Send" },
} as const;
const FEEDBACK_CATEGORY_EN: Record<FeedbackCategoryCode, string> = {
  recorder: "bumblebee",
  meetings: "Meetings",
  search: "Search",
  tasks: "Tasks",
  knowledge: "Knowledge base",
  digest: "Digest",
  auth: "Sign-in / access",
  integrations: "Integrations",
  claude: "Claude / MCP",
  ui: "Interface",
  other: "Other",
};

type Props = { onDone?: () => void };

export function FeedbackForm({ onDone }: Props) {
  const dt = useDt();
  const [text, setText] = useState("");
  const [category, setCategory] = useState<FeedbackCategoryCode>("other");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    try {
      await sendFeedback(text.trim(), category, file);
      setText("");
      setCategory("other");
      setFile(null);
      setSent(true);
      setTimeout(() => { setSent(false); onDone?.(); }, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="fb-cat">{dt(FEEDBACK_COPY.section.ru, FEEDBACK_COPY.section.en)}</Label>
        <Select value={category} onValueChange={(v) => setCategory(v as FeedbackCategoryCode)}>
          <SelectTrigger id="fb-cat">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FEEDBACK_CATEGORIES.map((c) => (
              <SelectItem key={c.code} value={c.code}>{dt(c.label, FEEDBACK_CATEGORY_EN[c.code] ?? c.label)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Textarea
        placeholder={dt(FEEDBACK_COPY.placeholder.ru, FEEDBACK_COPY.placeholder.en)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="text-sm min-h-[100px]"
      />

      <div className="space-y-1.5">
        <Label htmlFor="fb-file" className="text-ink-soft">{dt(FEEDBACK_COPY.screenshot.ru, FEEDBACK_COPY.screenshot.en)}</Label>
        <input
          id="fb-file"
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:bg-surface"
        />
        {file && <p className="truncate text-xs text-ink-soft">📎 {file.name}</p>}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button onClick={handleSend} disabled={sending || !text.trim()} className="w-full">
        {sending ? dt(FEEDBACK_COPY.sending.ru, FEEDBACK_COPY.sending.en) : sent ? dt(FEEDBACK_COPY.sent.ru, FEEDBACK_COPY.sent.en) : dt(FEEDBACK_COPY.send.ru, FEEDBACK_COPY.send.en)}
      </Button>
    </div>
  );
}
