import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  applyGeneralSentinel,
  buildEmbeddingInput,
  embed,
  extractEntryMeta,
  marketTagsFromInput,
} from "./meta-extract.ts";
import { findDuplicateMeeting, type MeetingAttendee } from "./meeting-dedup.ts";
import { arbitrateFullness, type TranscriptLike } from "./meeting-fullness.ts";

// Публикация черновика встречи (таблица meetings) в базу знаний (entries). Одна реализация
// для веба (swarm-api POST /agent-meetings/:id/publish) и MCP (publish_draft_meeting, issue #513):
// дедуп против уже лежащей в базе встречи, арбитраж полноты версий, рынки, эмбеддинг, защита
// от гонки параллельной публикации. Вынесено из swarm-api/index.ts без изменения поведения —
// ответ веба прежний байт в байт (status + тело записи).
//
// Доступ к черновику проверяет ВЫЗЫВАЮЩИЙ (canAccessDraftMeeting) — сюда приходит уже
// разрешённая строка.

export type PublishDraftOptions = {
  groupId: string;
  telegramId: number;
  /** E-mail публикующего — сигнал дедупа для записи из комнаты. */
  viewerEmail: string | null;
  /** base === "personal" на экране вычитки. */
  isPrivate: boolean;
  /** Рынки, выбранные человеком; undefined — классификатор по тезисам. */
  countries: unknown;
  /** Какие колонки entries вернуть (у веба — ENTRY_COLUMNS). */
  entryColumns: string;
};

export type PublishDraftResult =
  | { ok: true; status: 200 | 201; entry: Record<string, unknown> }
  | { ok: false; status: 400 | 500; message: string };

export async function publishDraftMeeting(
  supabase: SupabaseClient,
  meeting: Record<string, unknown>,
  opts: PublishDraftOptions,
): Promise<PublishDraftResult> {
  const meetingId = meeting.id as string;
  // Строка колонок приходит параметром, и supabase-js не может вывести из неё тип строки
  // (GenericStringError). «*» для компилятора — строка без схемы, Record<string, any>;
  // в запрос уходит настоящий список колонок.
  const cols = opts.entryColumns as "*";
  // идемпотентность: уже опубликовано → вернуть существующую запись
  if (meeting.status === "in_base" && meeting.entry_id) {
    const { data: existing } = await supabase.from("entries").select(
      cols,
    ).eq("id", meeting.entry_id as string).single();
    return {
      ok: true,
      status: 200,
      entry: existing as Record<string, unknown>,
    };
  }
  const draft = meeting.draft_notes_md as string | null;
  if (!draft) {
    return {
      ok: false,
      status: 400,
      message: "Тезисы ещё не готовы — публиковать нечего",
    };
  }

  // Рынки: приоритет у человека (issue #73). Пришли в теле с экрана вычитки — они и
  // авторитетны, классификатор не зовём вовсе (ни лишнего вызова, ни его перетега).
  // Порог 2+ применяется и к ним (issue #167, решение владельца 2026-08-28): чипы
  // предзаполнены подсказкой, поэтому «выбрал человек» на практике часто значит
  // «предложила система, человек нажал Согласовать» — а 2 рынка в записи это кросс-маркет,
  // и она всплывала бы в дайджесте КАЖДОЙ из стран. Пустой список = «Общее», в базе это тег
  // General, а не отсутствие тега. Поля countries в теле нет (бот, старый клиент) → классификатор.
  const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
  const countries = Array.isArray(opts.countries)
    ? marketTagsFromInput(opts.countries as string[])
    : applyGeneralSentinel(
      (await extractEntryMeta(draft, OPENAI_KEY)).countries,
    );
  const embedding = await embed(
    buildEmbeddingInput(draft, countries),
    OPENAI_KEY,
  );

  const startedAt = meeting.started_at as string | null;
  const entryDate = startedAt ? startedAt.split("T")[0] : null;
  const mAttendees = (meeting as { attendees?: MeetingAttendee[] }).attendees ??
    [];

  // Кросс-источниковый дедуп: эта встреча уже в базе (Granola / повторный паблиш)?
  // Если совпавшая запись видима публикующему (публичная или его личная) — привязываем
  // meeting к ней и возвращаем её, а не плодим вторую. Чужие приватные записи игнорируем
  // (не привязываемся к ним и не раскрываем) — тогда публикуем как обычно.
  const dup = await findDuplicateMeeting(supabase, {
    groupId: opts.groupId,
    entryDate,
    startedAt,
    attendees: mAttendees,
    // identity_key решает однозначно только для СРАВНИМЫХ ключей (одно календарное событие
    // или одна комната у двух рекордеров); ключи из разных пространств им не разводятся (#164).
    identityKey: (meeting.identity_key as string | null) ?? null,
    // Название — сигнал для Granola-записей (участников она не отдаёт вовсе).
    title: (meeting.title as string | null) ?? null,
    // E-mail публикующего — сигнал для записи из комнаты (ни названия, ни участников):
    // сам записавший есть в attendees календарной записи той же встречи.
    viewerEmail: opts.viewerEmail,
    viewerId: opts.telegramId,
  });
  // Фильтр приватности теперь ВНУТРИ findDuplicateMeeting (issue #45) — чужое личное сюда
  // не доходит; прежняя ручная проверка на этой строке была единственной из четырёх.
  if (dup) {
    await supabase.from("meetings")
      .update({
        entry_id: dup.id,
        status: "in_base",
        updated_at: new Date().toISOString(),
      })
      .eq("id", meetingId)
      .is("entry_id", null);

    // «В базу по дефолту идёт САМАЯ ПОЛНАЯ встреча» (решение владельца 2026-08-28, issue #176).
    // Прежде тут молча оставалась версия того, кто опубликовал раньше — то самое правило
    // «кто первый», за которое проект уже заплатил потерей записи на 2ч26м в claim (#23/#24).
    // Полноту меряем объёмом РАСПОЗНАННОГО: длительность к потере звука собеседника слепа
    // (26.08: 1920 с против 1980 с при 469 против 1097 сегментов).
    const { data: pubMeeting } = await supabase.from("meetings")
      .select("id, transcript, notes_edited_at")
      .eq("entry_id", dup.id)
      .neq("id", meetingId)
      .order("recorded_seconds", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const verdict = arbitrateFullness(
      {
        transcript: (meeting as { transcript?: TranscriptLike }).transcript ??
          null,
        notesEditedAt: (meeting.notes_edited_at as string | null) ?? null,
      },
      {
        transcript: (pubMeeting as { transcript?: TranscriptLike } | null)
          ?.transcript ?? null,
        notesEditedAt:
          (pubMeeting as { notes_edited_at?: string | null } | null)
            ?.notes_edited_at ?? null,
      },
    );

    if (verdict.replace) {
      // Заменяем СОДЕРЖИМОЕ записи, id сохраняется: ссылки, задачи и привязки не рвутся.
      // Прежние тезисы не пропадают — они остаются в draft_notes_md своей строки meetings,
      // а факт замены пишем в metadata (кто, когда, чем именно оказалась полнее).
      const prevMeta =
        ((dup as unknown as { metadata?: Record<string, unknown> })
          .metadata ?? {}) as Record<string, unknown>;
      const { data: prevEntry } = await supabase.from("entries").select(
        "metadata",
      ).eq("id", dup.id).single();
      const baseMeta =
        ((prevEntry as { metadata?: Record<string, unknown> } | null)
          ?.metadata ?? prevMeta) as Record<string, unknown>;
      const newEmbedding = await embed(
        buildEmbeddingInput(draft, countries),
        OPENAI_KEY,
      );
      await supabase.from("entries").update({
        content: draft,
        summary: draft,
        embedding: newEmbedding,
        metadata: {
          ...baseMeta,
          meeting_id: meetingId,
          title: meeting.title ?? baseMeta.title ?? null,
          attendees: (meeting as { attendees?: unknown }).attendees ??
            baseMeta.attendees ?? [],
          identity_key: (meeting.identity_key as string | null) ?? null,
          superseded: {
            at: new Date().toISOString(),
            by_telegram_id: opts.telegramId,
            reason: verdict.reason,
            prev_meeting_id: (pubMeeting as { id?: string } | null)?.id ??
              null,
          },
        },
        updated_at: new Date().toISOString(),
      }).eq("id", dup.id);
      console.log(
        `publish: версия встречи заменена на более полную ${dup.id} (${verdict.reason}, by ${opts.telegramId})`,
      );
    }

    const { data: existing } = await supabase.from("entries").select(
      cols,
    ).eq("id", dup.id).single();
    // Клиент обязан сказать правду (issue #170): либо «твоя версия стала основной, она полнее»,
    // либо «встреча уже в базе, там своя версия — ты правишь общую запись». Прежний ответ был
    // неотличим от «создал новую», и тост уверял «Черновик опубликован».
    return {
      ok: true,
      status: 200,
      entry: {
        ...(existing as Record<string, unknown>),
        duplicate: true,
        replaced: verdict.replace,
        arbitration: verdict.reason,
      },
    };
  }

  const { data: created, error: insErr } = await supabase.from("entries")
    .insert({
      content: draft,
      summary: draft,
      embedding,
      added_by: String(opts.telegramId),
      source: (meeting.source as string) ?? "desktop-agent", // рекордер/granola/… — сохраняем провенанс
      entry_type: "meeting",
      // attendees из календаря (meetings.attendees, собран рекордером при claim) — несём в запись,
      // чтобы участники были видны и после публикации (UI: блок «Участники»).
      // identity_key несём в запись, чтобы будущий дедуп мог отличить разные встречи одного дня
      // с тем же составом (регулярные командные созвоны) от повторной записи той же встречи.
      metadata: {
        meeting_id: meetingId,
        title: meeting.title ?? null,
        confirmed: true,
        attendees: (meeting as { attendees?: unknown }).attendees ?? [],
        identity_key: (meeting.identity_key as string | null) ?? null,
      },
      countries,
      entry_date: entryDate,
      group_id: opts.groupId,
      is_private: opts.isPrivate,
      // Автор = тот, кто записал встречу и завёл её в систему. Раньше здесь стояло
      // `opts.isPrivate ? opts.telegramId : null`: у общей записи автор стирался, потому что
      // owner_id тащит две роли сразу — авторство и ключ приватности, а для видимости
      // общей записи он не нужен (фильтр `is_private=false OR owner_id=…` проходит по
      // первой половине). На видимость это поле у общей записи не влияет, зато без него
      // автор не мог править и удалять собственную опубликованную встречу.
      owner_id: opts.telegramId,
    }).select(cols).single();
  if (insErr || !created) {
    return {
      ok: false,
      status: 500,
      message: insErr?.message ?? "publish failed",
    };
  }

  // привязка + статус с защитой от гонки (только если ещё не привязано)
  const { data: linked } = await supabase.from("meetings")
    .update({
      entry_id: (created as { id: string }).id,
      status: "in_base",
      updated_at: new Date().toISOString(),
    })
    .eq("id", meetingId)
    .is("entry_id", null)
    .select("id")
    .maybeSingle();
  if (!linked) {
    // параллельная публикация — убираем дубль, возвращаем уже привязанную запись
    await supabase.from("entries").delete().eq(
      "id",
      (created as { id: string }).id,
    );
    const { data: m2 } = await supabase.from("meetings").select("entry_id")
      .eq("id", meetingId).single();
    const existingId = (m2 as { entry_id: string | null }).entry_id;
    const { data: existing } = await supabase.from("entries").select(
      cols,
    ).eq("id", existingId as string).single();
    return {
      ok: true,
      status: 200,
      entry: existing as Record<string, unknown>,
    };
  }
  // Задачи НЕ генерируем автоматически. Пользователь создаёт их вручную кнопкой
  // «Сгенерировать задачи» в ревью встречи / на экране встречи (preview → добавить).
  return { ok: true, status: 201, entry: created as Record<string, unknown> };
}
