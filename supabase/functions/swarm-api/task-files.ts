import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "./http.ts";
import { canMutateTask, canViewTask } from "../_shared/tasks/access.ts";
import { importSigningKey, signFileToken } from "../_shared/files-token.ts";
import {
  canRemoveTaskFile,
  checkNewFile,
  isInline,
  type NewFileError,
  taskFileLimits,
} from "../_shared/task-files.ts";

// Роуты файлов к задаче (решение владельца 2026-09-30, docs/decisions/2026-09-30-task-files-on-muspelheim.md):
//   GET    /tasks/:id/files                 — список + лимиты (веб показывает их под кнопкой)
//   POST   /tasks/:id/files { name, size }  — завести файл и выдать ссылку на загрузку
//   POST   /tasks/:id/files/:fid/complete   — подтвердить: сервис сверяет, что байты на месте
//   GET    /tasks/:id/files/:fid/url        — ссылка на скачивание (10 минут)
//   DELETE /tasks/:id/files/:fid            — убрать (архивация)
// Доступ к файлу = доступ к задаче (`canViewTask`); 404 и на чужое, и на отсутствующее.
// Байты идут браузер ↔ MUSPELHEIM напрямую, мимо функции: функция только подписывает ссылку.

const UPLOAD_TTL_SEC = 15 * 60;
const DOWNLOAD_TTL_SEC = 10 * 60;
const HEAD_TIMEOUT_MS = 8000;

const LIST = /^\/tasks\/([^/]+)\/files$/;
const ONE = /^\/tasks\/([^/]+)\/files\/([^/]+)$/;
const COMPLETE = /^\/tasks\/([^/]+)\/files\/([^/]+)\/complete$/;
const URL_RE = /^\/tasks\/([^/]+)\/files\/([^/]+)\/url$/;

const ERROR_TEXT: Record<NewFileError, string> = {
  name: "Нет имени файла",
  type: "Такой тип файла не принимаем",
  empty: "Файл пустой",
  too_big: "Файл больше лимита",
  too_many: "У задачи уже максимум файлов",
};

type TaskRow = {
  id: string;
  group_id: string | null;
  is_private: boolean;
  owner_id: number | null;
};
type FileRow = {
  id: string;
  name: string;
  size_bytes: number;
  mime: string;
  storage_key: string;
  uploaded_by: number;
  status: "pending" | "ready";
  created_at: string;
};
const FILE_COLS =
  "id, name, size_bytes, mime, storage_key, uploaded_by, status, created_at";

let signingKey: Promise<CryptoKey> | null = null;

/** Хранилище настроено, если есть и адрес сервиса, и ключ подписи. */
function storage(): { base: string; key: () => Promise<CryptoKey> } | null {
  const base = Deno.env.get("FILES_BASE_URL")?.replace(/\/+$/, "");
  const pkcs8 = Deno.env.get("FILES_SIGNING_KEY");
  if (!base || !pkcs8) return null;
  return { base, key: () => (signingKey ??= importSigningKey(pkcs8)) };
}

function publicFile(f: FileRow, names: Map<number, string>) {
  return {
    id: f.id,
    name: f.name,
    size: f.size_bytes,
    mime: f.mime,
    inline: isInline(f.name),
    uploaded_by: f.uploaded_by,
    uploaded_by_name: names.get(f.uploaded_by) ?? null,
    created_at: f.created_at,
  };
}

export async function handleTaskFileRoutes(
  supabase: SupabaseClient,
  req: Request,
  routePath: string,
  telegramId: number,
  groupId: string,
  isAdmin: boolean,
  origin: string,
  resolveNames: (ids: number[]) => Promise<Map<number, string>>,
): Promise<Response | null> {
  const list = routePath.match(LIST);
  const complete = routePath.match(COMPLETE);
  const url = routePath.match(URL_RE);
  const one = complete || url ? null : routePath.match(ONE);
  const m = list ?? complete ?? url ?? one;
  if (!m) return null;

  const { data: taskData } = await supabase.from("tasks")
    .select("id, group_id, is_private, owner_id").eq("id", m[1]).maybeSingle();
  const task = taskData as TaskRow | null;
  if (
    !task || task.group_id !== groupId ||
    !canViewTask(task, telegramId, isAdmin)
  ) {
    return json({ error: "Задача не найдена" }, 404, origin);
  }
  const limits = taskFileLimits((n) => Deno.env.get(n));
  const store = storage();

  if (list && req.method === "GET") {
    const { data, error } = await supabase.from("task_files").select(FILE_COLS)
      .eq("task_id", task.id).eq("status", "ready").is("archived_at", null)
      .order("created_at", { ascending: true });
    if (error) {
      console.error("task_files list failed:", error);
      return json({ error: "Не удалось загрузить файлы" }, 500, origin);
    }
    const rows = (data ?? []) as FileRow[];
    const names = await resolveNames([
      ...new Set(rows.map((r) => r.uploaded_by)),
    ]);
    return json(
      {
        files: rows.map((r) => publicFile(r, names)),
        limits,
        available: !!store,
      },
      200,
      origin,
    );
  }

  if (list && req.method === "POST") {
    if (!canMutateTask(task, telegramId, isAdmin)) {
      return json({ error: "Задача не найдена" }, 404, origin);
    }
    if (!store) {
      return json({ error: "Хранилище файлов не настроено" }, 503, origin);
    }
    const { count } = await supabase.from("task_files").select("id", {
      count: "exact",
      head: true,
    })
      .eq("task_id", task.id).eq("status", "ready").is("archived_at", null);
    const input = checkNewFile(
      await req.json().catch(() => null),
      limits,
      count ?? 0,
    );
    if ("error" in input) {
      return json(
        { error: ERROR_TEXT[input.error], code: input.error, limits },
        400,
        origin,
      );
    }
    const storageKey = crypto.randomUUID();
    const { data, error } = await supabase.from("task_files").insert({
      task_id: task.id,
      group_id: groupId,
      name: input.name,
      size_bytes: input.size,
      mime: input.mime,
      storage_key: storageKey,
      uploaded_by: telegramId,
    }).select(FILE_COLS).single();
    if (error) {
      console.error("task_files insert failed:", error);
      return json({ error: "Не удалось завести файл" }, 500, origin);
    }
    const token = await signFileToken(await store.key(), {
      k: storageKey,
      op: "put",
      exp: nowSec() + UPLOAD_TTL_SEC,
      max: input.size,
    });
    const file = data as FileRow;
    return json(
      {
        file: publicFile(file, new Map()),
        upload_url: objectUrl(store.base, storageKey, token),
      },
      201,
      origin,
    );
  }

  const fileId = (complete ?? url ?? one)?.[2];
  if (!fileId) return null;
  const { data: fileData } = await supabase.from("task_files").select(FILE_COLS)
    .eq("id", fileId).eq("task_id", task.id).is("archived_at", null)
    .maybeSingle();
  const file = fileData as FileRow | null;
  if (!file) return json({ error: "Файл не найден" }, 404, origin);

  if (complete && req.method === "POST") {
    if (file.uploaded_by !== telegramId) {
      return json({ error: "Файл не найден" }, 404, origin);
    }
    if (file.status === "ready") {
      return json({ file: publicFile(file, new Map()) }, 200, origin);
    }
    if (!store) {
      return json({ error: "Хранилище файлов не настроено" }, 503, origin);
    }
    const size = await storedSize(store, file.storage_key);
    if (size === null) {
      return json({ error: "Хранилище файлов сейчас недоступно" }, 502, origin);
    }
    if (size !== file.size_bytes) {
      return json(
        { error: "Файл загрузился не целиком — попробуйте ещё раз" },
        409,
        origin,
      );
    }
    const { error } = await supabase.from("task_files").update({
      status: "ready",
    }).eq("id", file.id);
    if (error) {
      console.error("task_files complete failed:", error);
      return json({ error: "Не удалось сохранить файл" }, 500, origin);
    }
    return json(
      { file: publicFile({ ...file, status: "ready" }, new Map()) },
      200,
      origin,
    );
  }

  if (url && req.method === "GET") {
    if (file.status !== "ready") {
      return json({ error: "Файл не найден" }, 404, origin);
    }
    if (!store) {
      return json({ error: "Хранилище файлов не настроено" }, 503, origin);
    }
    const token = await signFileToken(await store.key(), {
      k: file.storage_key,
      op: "get",
      exp: nowSec() + DOWNLOAD_TTL_SEC,
      n: file.name,
      m: file.mime,
    });
    return json(
      { url: objectUrl(store.base, file.storage_key, token) },
      200,
      origin,
    );
  }

  if (one && req.method === "DELETE") {
    if (
      !canRemoveTaskFile(
        { uploadedBy: file.uploaded_by, taskOwnerId: task.owner_id },
        telegramId,
        isAdmin,
      )
    ) {
      return json(
        {
          error:
            "Убрать файл может тот, кто его прикрепил, или владелец задачи",
        },
        403,
        origin,
      );
    }
    const { error } = await supabase.from("task_files").update({
      archived_at: new Date().toISOString(),
    })
      .eq("id", file.id);
    if (error) {
      console.error("task_files archive failed:", error);
      return json({ error: "Не удалось убрать файл" }, 500, origin);
    }
    return json({ ok: true }, 200, origin);
  }
  return null;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function objectUrl(base: string, key: string, token: string): string {
  return `${base}/f/${key}?t=${encodeURIComponent(token)}`;
}

/** Размер объекта на сервере (HEAD с ссылкой на чтение); null — сервер не ответил или файла нет. */
async function storedSize(
  store: { base: string; key: () => Promise<CryptoKey> },
  key: string,
): Promise<number | null> {
  const token = await signFileToken(await store.key(), {
    k: key,
    op: "get",
    exp: nowSec() + 60,
  });
  try {
    const res = await fetch(objectUrl(store.base, key, token), {
      method: "HEAD",
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length"));
    return Number.isFinite(len) ? len : null;
  } catch (e) {
    console.error("swarm-files HEAD failed:", e);
    return null;
  }
}
