"use client";
// Баннер «нейросеть не работает» — только админам пространства и мастер-админу (#233, решение
// владельца 19.10.2026: «баннер чисто для админа в самой системе»). Причина — ключ отклонён,
// кончились деньги или квота, стабильные сбои; плюс следствие — встречи, застрявшие в обработке.
// Сервер сам решает, что считать настоящим сбоем (не единичное дрожание API) и что видит человек:
// админу — своё пространство, мастер-админу — все. Участникам запроса нет вовсе. Гаснет, когда
// после успешного вызова сервер больше не отдаёт сбой. Цвет — `--destructive` (у нас это «сломано»).
import { useEffect, useState } from "react";
import { useDt, useRoyNav } from "@/components/roy/nav";
import { fetchAiHealth, type AiHealth, type AiKeyIssue } from "@/lib/api";
import { canSeeKeyHealth } from "@/lib/adminAccess";
import { setAdminTarget } from "@/lib/adminTarget";

const POLL_MS = 5 * 60_000;
const STALL_MINUTES = 30; // зеркалит STALL_MINUTES сервера (_shared/ai-health.ts): только для подписи

export function KeyHealthBar() {
  const { me, push } = useRoyNav();
  const dt = useDt();
  const allowed = canSeeKeyHealth(me);
  const [health, setHealth] = useState<AiHealth | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    const load = () =>
      fetchAiHealth().then((h) => alive && setHealth(h)).catch((e) => console.error("[KeyHealthBar]", e));
    load();
    const t = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [allowed]);

  if (!allowed || !health || (health.issues.length === 0 && health.stalled.length === 0)) return null;

  const reasonText = (i: AiKeyIssue) => {
    const base = i.reason === "rejected"
      ? dt("ключ отклонён OpenAI", "the key was rejected by OpenAI")
      : i.reason === "quota"
      ? dt("кончились деньги или квота на ключе", "the key is out of quota or billing")
      : dt("нейросеть стабильно не отвечает", "the AI service keeps failing");
    return i.source === "server" ? `${base} ${dt("(общий ключ сервера)", "(shared server key)")}` : base;
  };
  const where = (name: string, id: string) => (id === "" ? dt("система", "system") : name);
  const openKey = (ws: string) => {
    if (ws) setAdminTarget({ ws, tab: "key" });
    push({ view: "admin" });
  };

  return (
    <div
      role="alert"
      className="flex shrink-0 flex-col gap-1 border-b px-4 py-2"
      style={{
        fontSize: 13,
        color: "var(--destructive)",
        borderColor: "color-mix(in srgb, var(--destructive) 40%, transparent)",
        background: "color-mix(in srgb, var(--destructive) 9%, var(--surface))",
      }}
    >
      <p className="font-semibold">{dt("Нейросеть не работает", "The AI is not working")}</p>
      {health.issues.map((i) => (
        <p key={`${i.group_id}|${i.source}`} className="text-ink">
          <span className="font-semibold">{where(i.workspace_name, i.group_id)}</span>: {reasonText(i)}.{" "}
          <button type="button" onClick={() => openKey(i.group_id)} className="font-semibold underline">
            {i.group_id === "" ? dt("Открыть админку", "Open admin") : dt("Открыть экран ключа", "Open the key screen")}
          </button>
        </p>
      ))}
      {health.stalled.map((s) => (
        <p key={`stalled|${s.group_id}`} className="text-ink">
          <span className="font-semibold">{s.workspace_name}</span>:{" "}
          {dt(
            `встреч в обработке дольше ${STALL_MINUTES} минут: ${s.count} — тезисы не готовятся`,
            `${s.count} meeting(s) processing for over ${STALL_MINUTES} minutes — notes are not being produced`,
          )}.
        </p>
      ))}
    </div>
  );
}
