import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiErr, json } from "./http.ts";
import { serverError } from "./client-error.ts";
import { assigneeFieldsFor, loadPeople } from "./people.ts";
import {
  dueDateOf,
  isAddresseeDone,
  isStickerVisible,
  parseStickerInput,
  type StickerInput,
  type StickerKind,
  taskDescription,
} from "./stickers-core.ts";
import { createTask } from "../_shared/tasks/db.ts";
import { archivePatch, onlyLive } from "../_shared/tasks/live.ts";

// Стикеры-задания на главной (v1). Канон: docs/decisions/2026-10-08-people-stickers-ratings-mail.md §2.
//   • GET  /stickers              — живые стикеры СВОЕГО воркспейса с адресатами и их выполнением.
//   • POST /stickers              — только админ. 'task': каждому адресату заводится задача
//                                   (createTask, source 'board_sticker'); 'notice': только адресаты.
//   • POST /stickers/:id/ack      — адресат отмечает «Понятно» на объявлении.
//   • POST /stickers/:id/archive  — только админ; стикер уходит в архив, задачи не трогаются.
// Создание стикера НИКОМУ ничего не отправляет (решение владельца: никакой коммуникации с людьми
// без его «да» на текст и адресатов) — ни напоминаний бота, ни рассылки: remind_date пустой.
// Доступ — только в коде (service_role): каждый запрос ограничен group_id.

const LIST_LIMIT = 60;
const PAGE = 1000;
const ID_CHUNK = 50;
const TASK_BATCH = 10;
const ITEM_RE = /^\/stickers\/([^/]+)\/(ack|archive)$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STICKER_COLUMNS = "id, kind, title, body, due_at, tone, link, created_by, created_at";

type Ctx = {
  supabase: SupabaseClient;
  telegramId: number;
  groupId: string | null;
  isDemo: boolean;
  isAdmin: boolean;
  origin: string;
};

type StickerRow = {
  id: string;
  kind: StickerKind;
  title: string;
  body: string;
  due_at: string | null;
  tone: string;
  link: string | null;
  created_by: number;
  created_at: string;
};

type LinkRow = { sticker_id: string; person_id: string; task_id: string | null; acked_at: string | null };
type TaskRow = { id: string; status: string; due_date: string | null };

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Роуты /stickers*. null — путь не про стикеры, index.ts идёт дальше. */
export async function handleStickerRoutes(ctx: Ctx, req: Request, routePath: string): Promise<Response | null> {
  try {
    if (routePath === "/stickers" && req.method === "GET") return await list(ctx);
    if (routePath === "/stickers" && req.method === "POST") return await create(ctx, req);
    const item = routePath.match(ITEM_RE);
    if (item && req.method === "POST") {
      return item[2] === "ack" ? await ack(ctx, item[1]) : await archive(ctx, item[1]);
    }
  } catch (e) {
    return serverError(ctx.origin, `stickers ${routePath}`, e);
  }
  return null;
}

// ── Чтение ──────────────────────────────────────────────────────────────────────────────────

/** Все строки адресатов стикеров — страницами: потолок ответа PostgREST 1000 строк, а адресатов до 200 на стикер. */
async function loadLinks(supabase: SupabaseClient, stickerIds: string[]): Promise<LinkRow[]> {
  const out: LinkRow[] = [];
  for (let from = 0;; from += PAGE) {
    const { data, error } = await supabase
      .from("board_sticker_people")
      .select("sticker_id, person_id, task_id, acked_at")
      .in("sticker_id", stickerIds)
      .order("sticker_id")
      .order("person_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`board_sticker_people: ${error.message}`);
    out.push(...((data ?? []) as LinkRow[]));
    if (!data || data.length < PAGE) return out;
  }
}

async function loadTasks(supabase: SupabaseClient, taskIds: string[]): Promise<Map<string, TaskRow>> {
  const parts = await Promise.all(
    chunks(taskIds, ID_CHUNK).map(async (ids) => {
      const { data, error } = await onlyLive(supabase.from("tasks").select("id, status, due_date").in("id", ids));
      if (error) throw new Error(`tasks: ${error.message}`);
      return (data ?? []) as unknown as TaskRow[];
    }),
  );
  return new Map(parts.flat().map((t) => [t.id, t]));
}

/**
 * Стикеры воркспейса в виде для клиента. Адресат — {person_id, name, telegram_id, done, acked_at,
 * task_id, task_due}; `mine` — вызывающий среди адресатов (по аккаунту человека). Задача, которую
 * убрали в архив, в выборку не попадает, и адресат считается невыполнившим.
 */
async function present(ctx: Ctx, groupId: string, onlyId?: string) {
  const { supabase } = ctx;
  let q = supabase.from("board_stickers").select(STICKER_COLUMNS).eq("group_id", groupId).is("archived_at", null);
  if (onlyId) q = q.eq("id", onlyId);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(LIST_LIMIT);
  if (error) throw new Error(`board_stickers: ${error.message}`);
  const stickers = (data ?? []) as StickerRow[];
  if (stickers.length === 0) return [];

  const links = await loadLinks(supabase, stickers.map((s) => s.id));
  const personIds = [...new Set(links.map((l) => l.person_id))];
  const taskIds = [...new Set(links.flatMap((l) => (l.task_id ? [l.task_id] : [])))];
  const [peopleParts, tasks] = await Promise.all([
    Promise.all(chunks(personIds, ID_CHUNK).map((ids) => loadPeople(supabase, groupId, ids))),
    loadTasks(supabase, taskIds),
  ]);
  const people = new Map(peopleParts.flat().map((p) => [p.id, p]));

  const now = new Date();
  const out = [];
  for (const s of stickers) {
    const addressees = links.filter((l) => l.sticker_id === s.id).flatMap((l) => {
      const p = people.get(l.person_id);
      if (!p) return []; // человека убрали в архив — со стикера уходит и он
      const task = l.task_id ? tasks.get(l.task_id) : undefined;
      return [{
        person_id: l.person_id,
        name: p.name,
        telegram_id: p.telegram_id,
        done: isAddresseeDone(s.kind, { acked_at: l.acked_at, task_status: task?.status ?? null }),
        acked_at: l.acked_at,
        task_id: l.task_id,
        task_due: task?.due_date ?? null,
      }];
    }).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (!isStickerVisible(s.due_at, addressees.map((a) => a.done), now)) continue;
    out.push({ ...s, mine: addressees.some((a) => a.telegram_id === ctx.telegramId), addressees });
  }
  return out;
}

async function list(ctx: Ctx): Promise<Response> {
  if (!ctx.groupId) return json([], 200, ctx.origin);
  return json(await present(ctx, ctx.groupId), 200, ctx.origin);
}

// ── Создание ────────────────────────────────────────────────────────────────────────────────

/** Адресаты: «все» — люди воркспейса с аккаунтом; иначе перечисленные, и каждый обязан быть из этого воркспейса. */
async function resolveAddressees(supabase: SupabaseClient, groupId: string, input: StickerInput) {
  let ids = input.person_ids;
  if (input.all) {
    const { data, error } = await supabase.from("people").select("id").eq("group_id", groupId)
      .is("archived_at", null).not("account_id", "is", null).limit(1000);
    if (error) throw new Error(`people: ${error.message}`);
    ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  }
  const wanted = ids ?? [];
  const found = (await Promise.all(chunks(wanted, ID_CHUNK).map((c) => loadPeople(supabase, groupId, c)))).flat();
  return { wanted, found };
}

async function rollback(ctx: Ctx, stickerId: string, taskIds: string[]): Promise<void> {
  const { supabase, telegramId } = ctx;
  const { error } = await supabase.from("board_stickers").update({ archived_at: new Date().toISOString() })
    .eq("id", stickerId);
  if (error) console.error(`[stickers] rollback: sticker ${stickerId} not archived: ${error.message}`);
  if (taskIds.length === 0) return;
  const res = await supabase.from("tasks").update(archivePatch(telegramId)).in("id", taskIds);
  if (res.error) console.error(`[stickers] rollback: ${taskIds.length} tasks not archived: ${res.error.message}`);
}

async function create(ctx: Ctx, req: Request): Promise<Response> {
  const { supabase, telegramId, groupId, isDemo, isAdmin, origin } = ctx;
  if (isDemo || !isAdmin || !groupId) return apiErr(403, "Forbidden", origin);

  const body = await req.json().catch(() => null);
  const parsed = parseStickerInput(body);
  if (!parsed.ok) return apiErr(400, parsed.error, origin);
  const input = parsed.value;

  const { wanted, found } = await resolveAddressees(supabase, groupId, input);
  if (wanted.length === 0) return apiErr(400, "В воркспейсе нет людей с аккаунтом", origin);
  if (found.length !== new Set(wanted).size) return apiErr(400, "Человек не найден в этом воркспейсе", origin);
  if (found.length > 200) return apiErr(400, "Адресатов — не больше 200", origin);

  const { data: row, error: insErr } = await supabase.from("board_stickers").insert({
    group_id: groupId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    due_at: input.due_at,
    tone: input.tone,
    link: input.link,
    created_by: telegramId,
  }).select("id").single();
  if (insErr || !row) return serverError(origin, "sticker insert", insErr ?? new Error("no row"));
  const stickerId = (row as { id: string }).id;

  const taskByPerson = new Map<string, string>();
  try {
    if (input.kind === "task") {
      const dueDate = dueDateOf(input.due_at);
      const description = taskDescription(input.body, input.link);
      for (const batch of chunks(found, TASK_BATCH)) {
        const tasks = await Promise.all(batch.map((p) =>
          createTask({
            title: input.title,
            description,
            ...assigneeFieldsFor(p),
            ...(dueDate ? { due_date: dueDate } : {}),
            remind_date: null,
            source: "board_sticker",
            confirmed: true,
            created_by_telegram_id: telegramId,
          }, groupId).then((t) => ({ personId: p.id, taskId: t.id }), (e) => ({ error: e as unknown }))
        ));
        // Сначала запоминаем все созданные: при сбое соседа по пачке откат должен найти и их.
        for (const t of tasks) if (!("error" in t)) taskByPerson.set(t.personId, t.taskId);
        const failed = tasks.find((t) => "error" in t);
        if (failed && "error" in failed) throw failed.error;
      }
    }
    const { error } = await supabase.from("board_sticker_people").insert(
      found.map((p) => ({ sticker_id: stickerId, person_id: p.id, task_id: taskByPerson.get(p.id) ?? null })),
    );
    if (error) throw new Error(`board_sticker_people: ${error.message}`);
  } catch (e) {
    console.error(`[stickers] create failed, rolling back: ${e instanceof Error ? e.message : String(e)}`);
    await rollback(ctx, stickerId, [...taskByPerson.values()]);
    return apiErr(500, "Не удалось создать стикер: он убран, задачи не заведены. Попробуйте ещё раз", origin);
  }

  const [view] = await present(ctx, groupId, stickerId);
  return json(view ?? { id: stickerId }, 201, origin);
}

// ── Отметка и архив ─────────────────────────────────────────────────────────────────────────

async function liveSticker(ctx: Ctx, id: string): Promise<{ id: string; kind: StickerKind } | null> {
  if (!UUID_RE.test(id) || !ctx.groupId) return null;
  const { data, error } = await ctx.supabase.from("board_stickers").select("id, kind")
    .eq("id", id).eq("group_id", ctx.groupId).is("archived_at", null).maybeSingle();
  if (error) throw new Error(`board_stickers: ${error.message}`);
  return (data as { id: string; kind: StickerKind } | null) ?? null;
}

/** «Понятно»: отмечает только СВОЮ строку; чужой стикер и стикер не про тебя неотличимы (404). */
async function ack(ctx: Ctx, id: string): Promise<Response> {
  const { supabase, telegramId, groupId, isDemo, origin } = ctx;
  if (isDemo) return apiErr(403, "Forbidden", origin);
  const sticker = await liveSticker(ctx, id);
  if (!sticker || !groupId) return apiErr(404, "Not found", origin);
  if (sticker.kind !== "notice") return apiErr(400, "Отметка «Понятно» есть только у объявления", origin);

  const { data: acc, error: accErr } = await supabase.from("allowed_users").select("id")
    .eq("telegram_id", telegramId).eq("group_id", groupId).maybeSingle();
  if (accErr) throw new Error(`allowed_users: ${accErr.message}`);
  if (!acc) return apiErr(404, "Not found", origin);
  const { data: person, error: pErr } = await supabase.from("people").select("id")
    .eq("account_id", (acc as { id: number }).id).eq("group_id", groupId).maybeSingle();
  if (pErr) throw new Error(`people: ${pErr.message}`);
  if (!person) return apiErr(404, "Not found", origin);

  const personId = (person as { id: string }).id;
  const { data: row, error: rErr } = await supabase.from("board_sticker_people").select("acked_at")
    .eq("sticker_id", id).eq("person_id", personId).maybeSingle();
  if (rErr) throw new Error(`board_sticker_people: ${rErr.message}`);
  if (!row) return apiErr(404, "Not found", origin);
  const already = (row as { acked_at: string | null }).acked_at;
  if (already) return json({ ok: true, acked_at: already }, 200, origin);

  const ackedAt = new Date().toISOString();
  const { error } = await supabase.from("board_sticker_people").update({ acked_at: ackedAt })
    .eq("sticker_id", id).eq("person_id", personId).is("acked_at", null);
  if (error) throw new Error(`board_sticker_people: ${error.message}`);
  return json({ ok: true, acked_at: ackedAt }, 200, origin);
}

async function archive(ctx: Ctx, id: string): Promise<Response> {
  const { supabase, groupId, isDemo, isAdmin, origin } = ctx;
  if (isDemo || !isAdmin) return apiErr(403, "Forbidden", origin);
  if (!UUID_RE.test(id) || !groupId) return apiErr(404, "Not found", origin);
  const { data, error } = await supabase.from("board_stickers")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id).eq("group_id", groupId).is("archived_at", null).select("id");
  if (error) throw new Error(`board_stickers: ${error.message}`);
  if (!data?.length) return apiErr(404, "Not found", origin);
  return json({ ok: true }, 200, origin);
}
