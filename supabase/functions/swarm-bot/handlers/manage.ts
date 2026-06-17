// Управление записями из чата: правка/удаление (детерминированный флоу,
// без участия LLM в исполнении). Поиск → показать → кнопка подтверждения → действие.
// Намерение определяется в lib/intent.ts (classifyEntryCommand/parseManageCommand).

import { supabase } from "../lib/supabase.ts";
import { getEmbedding } from "../lib/openai.ts";
import { matchEntries } from "../../_shared/search.ts";
import {
  EntryAccessError,
  getManageableEntry,
  updateEntryContent,
  visibilityFilter,
  setSession,
  getSession,
  clearSession,
  type ManageableEntry,
} from "../lib/storage.ts";
import { sendMessage, sendInlineMessage } from "../lib/telegram.ts";
import { extractUrl, type EntryCommand } from "../lib/intent.ts";
import type { TgCallbackQuery } from "../lib/types.ts";

const MAX_RESULTS = 5;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

type Candidate = { id: string; title: string; date: string };

function titleOf(metadata: Record<string, unknown> | null | undefined, summary?: string | null, content?: string | null): string {
  const fromMeta = metadata?.title;
  if (typeof fromMeta === "string" && fromMeta.trim()) return fromMeta.trim().slice(0, 80);
  const line = (summary ?? content ?? "").split("\n").find((l) => l.trim());
  return (line ?? "запись").replace(/^[#*\s]+/, "").slice(0, 80) || "запись";
}

// Поиск конкретной записи для правки/удаления. Главное — ТОЧНОСТЬ: пользователь
// называет одну запись, мусор в списке недопустим. Семантика с реальным порогом +
// ключевые слова с требованием совпадения по ТЕМЕ (не по одному общему слову).
async function searchCandidates(query: string, userId: number, groupId: string): Promise<Candidate[]> {
  const scored = new Map<string, Candidate & { score: number }>();
  const add = (id: string, title: string, date: string, score: number) => {
    if (!id) return;
    const prev = scored.get(id);
    if (!prev || score > prev.score) scored.set(id, { id, title, date, score });
  };

  // 1. Семантика — только уверенные совпадения (порог 0.4, не 0.1: иначе в список
  //    попадает топ-5 «хоть как-то похожих», включая мусор).
  const emb = await getEmbedding(query).catch(() => null);
  if (emb) {
    const vec = await matchEntries(supabase, emb, {
      groupId, requestingUserId: userId, threshold: 0.4, limit: MAX_RESULTS,
    }).catch(() => []);
    for (const e of vec) {
      add(e.id, titleOf(e.metadata, e.summary, e.content), e.entry_date ?? "", 1 + (e.similarity ?? 0));
    }
  }

  // 2. Ключевые слова — кандидат проходит, только если совпала тема: хотя бы половина
  //    значимых слов запроса (минимум 2) ИЛИ все слова есть в заголовке. Ранжируем по числу
  //    совпадений. Это отсекает «совпало одно общее слово» (отсюда и был мусор в списке).
  const words = [...new Set(query.toLowerCase().split(/[\s,.!?]+/).filter((w) => w.length > 2))].slice(0, 6);
  if (words.length) {
    const { data } = await supabase.from("entries")
      .select("id, content, summary, metadata, entry_date, created_at")
      .or(words.map((w) => `content.ilike.%${w}%,summary.ilike.%${w}%`).join(","))
      .eq("group_id", groupId).or(visibilityFilter(userId)).limit(40);
    const need = Math.max(2, Math.ceil(words.length / 2));
    for (const e of (data ?? []) as Array<Record<string, unknown>>) {
      const meta = e.metadata as Record<string, unknown> | null;
      const titleStr = (typeof meta?.title === "string" ? meta.title : "").toLowerCase();
      const hay = `${titleStr} ${e.summary ?? ""} ${e.content ?? ""}`.toLowerCase();
      const hits = words.filter((w) => hay.includes(w)).length;
      const titleAll = titleStr.length > 0 && words.every((w) => titleStr.includes(w));
      if (hits >= need || titleAll) {
        add(
          e.id as string,
          titleOf(meta, e.summary as string, e.content as string),
          (e.entry_date as string) ?? (e.created_at as string)?.slice(0, 10) ?? "",
          (titleAll ? 10 : 0) + hits, // тайтл-матч приоритетнее семантики
        );
      }
    }
  }

  return [...scored.values()].sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS)
    .map(({ id, title, date }) => ({ id, title, date }));
}

function cardText(e: ManageableEntry): string {
  const title = titleOf(e.metadata, e.summary, e.content);
  const date = e.entry_date ?? e.created_at?.slice(0, 10) ?? "";
  const url = typeof e.metadata?.url === "string" ? (e.metadata.url as string) : undefined;
  const preview = (e.summary ?? e.content ?? "").slice(0, 300);
  return `📄 <b>${escapeHtml(title)}</b>${date ? ` (${date})` : ""}\n` +
    (url ? `🔗 ${escapeHtml(url)}\n` : "") +
    (preview ? `\n<i>${escapeHtml(preview)}</i>` : "");
}

async function showCard(chatId: number, userId: number, groupId: string, id: string, cmd: EntryCommand, newValue?: string): Promise<void> {
  let e: ManageableEntry;
  try {
    e = await getManageableEntry(id, userId, groupId);
  } catch (err) {
    await sendMessage(chatId, accessErrorText(err));
    await clearSession(chatId);
    return;
  }
  const actionBtn = cmd === "delete"
    ? { text: "🗑 Да, удалить", callback_data: `kbdo_${id}` }
    : newValue
      ? { text: "✏️ Заменить", callback_data: `kbdo_${id}` }
      : { text: "✏️ Ввести новое значение", callback_data: `kbask_${id}` };
  const tail = cmd === "replace" && newValue ? `\n\nНовое значение:\n<code>${escapeHtml(newValue)}</code>` : "";
  await sendInlineMessage(chatId, cardText(e) + tail, [
    [actionBtn],
    [{ text: "Отмена", callback_data: "kbno" }],
  ]);
}

function accessErrorText(err: unknown): string {
  if (err instanceof EntryAccessError) {
    return err.kind === "not_found" ? "Запись не найдена (возможно, уже удалена)." : "Нет доступа к этой записи.";
  }
  return `Ошибка: ${err instanceof Error ? err.message : String(err)}`;
}

/** Точка входа из роутинга сообщений: команда удаления/замены записи. */
export async function handleEntryCommand(
  chatId: number, userId: number, query: string, cmd: EntryCommand, groupId: string, newValue?: string,
): Promise<void> {
  if (!query.trim()) {
    await sendMessage(chatId, cmd === "delete"
      ? "Что удалить? Уточни тему, например: «удали запись про форму»."
      : "Что заменить? Уточни тему, например: «замени запись про форму на …».");
    return;
  }

  const candidates = await searchCandidates(query, userId, groupId);
  if (!candidates.length) {
    await sendMessage(chatId, `Не нашёл записи по запросу «${escapeHtml(query)}». Уточни тему.`);
    return;
  }

  // cmd + newValue нужны на шаге подтверждения — кладём в сессию.
  await setSession(chatId, "manage", JSON.stringify({ cmd, newValue: newValue ?? null }));

  if (candidates.length === 1) {
    await showCard(chatId, userId, groupId, candidates[0].id, cmd, newValue);
    return;
  }

  const verb = cmd === "delete" ? "удалить" : "заменить";
  await sendInlineMessage(chatId, `Нашёл несколько записей. Какую ${verb}?`,
    candidates.map((c) => [{
      text: `📄 ${c.title}${c.date ? ` (${c.date})` : ""}`.slice(0, 60),
      callback_data: `kbpick_${c.id}`,
    }]).concat([[{ text: "Отмена", callback_data: "kbno" }]]),
  );
}

type ManageState = { cmd: EntryCommand; newValue: string | null };

async function readState(chatId: number): Promise<ManageState | null> {
  const s = await getSession(chatId);
  if (s?.action !== "manage" || !s.context) return null;
  try {
    const parsed = JSON.parse(s.context) as ManageState;
    if (parsed.cmd === "delete" || parsed.cmd === "replace") return parsed;
  } catch { /* ignore */ }
  return null;
}

async function doDelete(chatId: number, userId: number, groupId: string, id: string): Promise<void> {
  await getManageableEntry(id, userId, groupId); // гейт доступа
  const { error } = await supabase.from("entries").delete().eq("id", id).eq("group_id", groupId);
  if (error) throw new Error(error.message);
  await clearSession(chatId);
  await sendMessage(chatId, "✅ Запись удалена.");
}

async function doReplace(chatId: number, userId: number, groupId: string, id: string, raw: string): Promise<void> {
  const entry = await getManageableEntry(id, userId, groupId); // гейт доступа
  const url = extractUrl(raw);
  const oldUrl = typeof entry.metadata?.url === "string" ? (entry.metadata.url as string) : undefined;

  let newContent: string;
  let metaPatch: Record<string, unknown> | undefined;
  if (url && oldUrl) {
    newContent = entry.content.includes(oldUrl)
      ? entry.content.split(oldUrl).join(url)
      : `${titleOf(entry.metadata, entry.summary, entry.content)}\n\nСсылка: ${url}`;
    metaPatch = { ...(entry.metadata ?? {}), url };
  } else if (url) {
    newContent = raw.trim();
    metaPatch = { ...(entry.metadata ?? {}), url };
  } else {
    newContent = raw.trim();
    metaPatch = undefined; // metadata без изменений
  }

  await updateEntryContent(id, groupId, newContent, metaPatch);
  await clearSession(chatId);
  await sendMessage(chatId, "✅ Запись обновлена.");
}

/** Обработка kb*-коллбеков. Возвращает true, если коллбек обработан. */
export async function handleManageCallbacks(
  cb: TgCallbackQuery, chatId: number, userId: number, _username: string, groupId: string,
): Promise<boolean> {
  const data = cb.data ?? "";
  if (!data.startsWith("kb")) return false;

  if (data === "kbno") {
    await clearSession(chatId);
    await sendMessage(chatId, "Отменено.");
    return true;
  }

  if (data.startsWith("kbpick_")) {
    const id = data.slice("kbpick_".length);
    const state = await readState(chatId);
    if (!state) { await sendMessage(chatId, "Сессия истекла, повтори команду."); return true; }
    await showCard(chatId, userId, groupId, id, state.cmd, state.newValue ?? undefined);
    return true;
  }

  if (data.startsWith("kbask_")) {
    const id = data.slice("kbask_".length);
    await setSession(chatId, "manage_replace", id);
    await sendMessage(chatId, "Пришли новое содержимое или ссылку:");
    return true;
  }

  if (data.startsWith("kbdo_")) {
    const id = data.slice("kbdo_".length);
    const state = await readState(chatId);
    if (!state) { await sendMessage(chatId, "Сессия истекла, повтори команду."); return true; }
    try {
      if (state.cmd === "delete") {
        await doDelete(chatId, userId, groupId, id);
      } else if (state.newValue) {
        await doReplace(chatId, userId, groupId, id, state.newValue);
      } else {
        await setSession(chatId, "manage_replace", id);
        await sendMessage(chatId, "Пришли новое содержимое или ссылку:");
      }
    } catch (err) {
      await sendMessage(chatId, accessErrorText(err));
      await clearSession(chatId);
    }
    return true;
  }

  return false;
}

/** Ввод нового значения для замены (сессия manage_replace). true, если обработано. */
export async function handleManageSessionInput(
  chatId: number, userId: number, action: string, text: string, context: string | undefined, groupId: string,
): Promise<boolean> {
  if (action !== "manage_replace") return false;
  if (!context) { await sendMessage(chatId, "Сессия истекла, повтори команду."); await clearSession(chatId); return true; }
  try {
    await doReplace(chatId, userId, groupId, context, text);
  } catch (err) {
    await sendMessage(chatId, accessErrorText(err));
    await clearSession(chatId);
  }
  return true;
}
