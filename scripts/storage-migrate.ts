/**
 * Перенос файлов команды из публичного бакета swarm_drive в приватный swarm_private
 * с наполнением реестра storage_files. Артефакт ночной раскатки (issue: утечка swarm_drive).
 *
 * Порядок безопасный: копия → сверка → перепись ссылок → и только потом, отдельным запуском
 * и явным флагом, удаление оригиналов. Ничего не удаляется, пока не проверено, что копия на
 * месте: файлы команды невосстановимы, второго шанса нет.
 *
 * Запуск (по умолчанию — СУХОЙ прогон, ничего не меняет):
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... deno run -A scripts/storage-migrate.ts plan
 *   ... deno run -A scripts/storage-migrate.ts init     --apply   # создать приватный бакет
 *   ... deno run -A scripts/storage-migrate.ts copy     --apply   # скопировать объекты
 *   ... deno run -A scripts/storage-migrate.ts backfill --apply   # реестр + ссылки в БД
 *   ... deno run -A scripts/storage-migrate.ts verify              # сверка (только читает)
 *   ... deno run -A scripts/storage-migrate.ts cleanup  --apply --i-verified
 *
 * Идемпотентно: повторный запуск пропускает уже перенесённое.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { storagePathFromLink } from "../supabase/functions/_shared/storage-links.ts";
import { PRIVATE_BUCKET } from "../supabase/functions/_shared/storage-files.ts";

const SOURCE_BUCKET = "swarm_drive";

// Папки файлов команды. recorder/ НЕ трогаем: установщик и апдейтер тянут ассеты анонимно,
// публичность там осознанная (см. ARCHITECTURE.md §Файлы и Storage).
const FOLDERS = ["uploads", "pdfs", "documents", "spreadsheets", "feedback"] as const;

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) {
  console.error("Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.");
  Deno.exit(1);
}
const supabase = createClient(url, key);

const phase = Deno.args[0] ?? "plan";
const apply = Deno.args.includes("--apply");
const verified = Deno.args.includes("--i-verified");

type Obj = { folder: string; path: string; size: number };

async function listFolder(bucket: string, folder: string): Promise<Obj[]> {
  const out: Obj[] = [];
  const PAGE = 100;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(folder, { limit: PAGE, offset });
    if (error) throw new Error(`list ${bucket}/${folder}: ${error.message}`);
    if (!data?.length) break;
    for (const f of data) {
      // Вложенные папки приходят без метаданных — раскрываем на уровень ниже.
      if (!f.metadata) {
        out.push(...await listFolder(bucket, `${folder}/${f.name}`));
        continue;
      }
      out.push({
        folder,
        path: `${folder}/${f.name}`,
        size: (f.metadata as { size?: number }).size ?? 0,
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

async function listAll(bucket: string): Promise<Obj[]> {
  const all: Obj[] = [];
  for (const folder of FOLDERS) all.push(...await listFolder(bucket, folder));
  return all;
}

function human(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1048576).toFixed(1)} МБ` : `${Math.round(bytes / 1024)} КБ`;
}

// ── plan ─────────────────────────────────────────────────────────────────────
async function planPhase() {
  const src = await listAll(SOURCE_BUCKET);
  const dst = new Map((await listAll(PRIVATE_BUCKET).catch(() => [])).map((o) => [o.path, o]));
  const todo = src.filter((o) => dst.get(o.path)?.size !== o.size);
  const bytes = todo.reduce((s, o) => s + o.size, 0);

  console.log(`В публичном бакете (файлы команды): ${src.length}, ${human(src.reduce((s, o) => s + o.size, 0))}`);
  console.log(`Уже в приватном: ${src.length - todo.length}`);
  console.log(`К переносу: ${todo.length}, ${human(bytes)}`);
  for (const f of FOLDERS) {
    const n = todo.filter((o) => o.path.startsWith(`${f}/`)).length;
    if (n) console.log(`  ${f}/ — ${n}`);
  }

  const { count: entriesWithFile } = await supabase.from("entries")
    .select("id", { count: "exact", head: true }).not("metadata->>file_url", "is", null);
  const { count: feedbackWithShot } = await supabase.from("feedback")
    .select("id", { count: "exact", head: true }).not("screenshot_url", "is", null);
  const { count: registered } = await supabase.from("storage_files")
    .select("path", { count: "exact", head: true });
  console.log(`\nЗаписей с файлом: ${entriesWithFile ?? 0}; фидбека со скрином: ${feedbackWithShot ?? 0}`);
  console.log(`Строк в реестре сейчас: ${registered ?? 0}`);
}

// ── init ─────────────────────────────────────────────────────────────────────
async function initPhase() {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((b) => b.name === PRIVATE_BUCKET)) {
    console.log(`Бакет ${PRIVATE_BUCKET} уже есть.`);
    return;
  }
  if (!apply) {
    console.log(`[сухой прогон] создал бы приватный бакет ${PRIVATE_BUCKET}`);
    return;
  }
  const { error } = await supabase.storage.createBucket(PRIVATE_BUCKET, { public: false });
  if (error) throw new Error(`createBucket: ${error.message}`);
  console.log(`Создан приватный бакет ${PRIVATE_BUCKET}.`);
}

// ── copy ─────────────────────────────────────────────────────────────────────
async function copyPhase() {
  const src = await listAll(SOURCE_BUCKET);
  const dst = new Map((await listAll(PRIVATE_BUCKET).catch(() => [])).map((o) => [o.path, o]));
  const todo = src.filter((o) => dst.get(o.path)?.size !== o.size);
  console.log(`К копированию: ${todo.length} из ${src.length}`);

  let done = 0, failed = 0;
  for (const o of todo) {
    if (!apply) { console.log(`[сухой прогон] ${o.path} (${human(o.size)})`); continue; }
    const { data, error: dlErr } = await supabase.storage.from(SOURCE_BUCKET).download(o.path);
    if (dlErr || !data) { console.error(`✗ скачать ${o.path}: ${dlErr?.message}`); failed++; continue; }
    const buf = await data.arrayBuffer();
    const { error: upErr } = await supabase.storage.from(PRIVATE_BUCKET).upload(o.path, buf, {
      contentType: data.type || "application/octet-stream",
      upsert: true,
    });
    if (upErr) { console.error(`✗ залить ${o.path}: ${upErr.message}`); failed++; continue; }
    // Сверка сразу: копия без проверки размера — это надежда, а не перенос.
    const { data: check } = await supabase.storage.from(PRIVATE_BUCKET)
      .list(o.path.split("/").slice(0, -1).join("/"), { search: o.path.split("/").pop() });
    const gotSize = (check?.[0]?.metadata as { size?: number } | undefined)?.size ?? -1;
    if (gotSize !== o.size) {
      console.error(`✗ размер не совпал ${o.path}: было ${o.size}, стало ${gotSize}`);
      failed++;
      continue;
    }
    done++;
    if (done % 20 === 0) console.log(`  …${done}`);
  }
  console.log(apply ? `Скопировано: ${done}, с ошибкой: ${failed}` : "Сухой прогон — ничего не изменено.");
  if (failed) Deno.exit(1);
}

// ── backfill ─────────────────────────────────────────────────────────────────
async function backfillPhase() {
  // Без таблицы реестра перепись ссылок превращает файлы в недоступные: ссылка уже путь,
  // а проверить доступ не по чему. Проверяем ДО первой записи, а не по ходу.
  const { error: regProbe } = await supabase.from("storage_files").select("path").limit(1);
  if (regProbe) {
    console.error(`Реестр storage_files недоступен (${regProbe.message}). Сначала миграции.`);
    Deno.exit(1);
  }

  // 1. Вложения записей.
  const { data: entries, error } = await supabase.from("entries")
    .select("id, metadata").not("metadata->>file_url", "is", null);
  if (error) throw new Error(`entries: ${error.message}`);

  const rows = (entries ?? []) as Array<{ id: string; metadata: Record<string, unknown> }>;
  let regs = 0, rewrites = 0, skipped = 0;
  const seen = new Set<string>();

  for (const e of rows) {
    const raw = e.metadata?.file_url;
    const path = storagePathFromLink(raw);
    if (!path) { skipped++; continue; }
    // Чанки одного файла — несколько записей на один путь: владельцем делаем первую.
    if (!seen.has(path)) {
      if (apply) {
        const { error: regErr } = await supabase.from("storage_files")
          .upsert({ path, bucket: PRIVATE_BUCKET, owner_kind: "entry", entry_id: e.id }, { onConflict: "path" });
        // Помечаем путь обработанным ТОЛЬКО после успеха: иначе следующая запись того же
        // файла (чанки делят один объект) сочтёт его зарегистрированным и перепишет ссылку
        // на путь, которого нет в реестре, — файл станет недоступен.
        if (regErr) { console.error(`✗ реестр ${path}: ${regErr.message}`); continue; }
      }
      seen.add(path);
      regs++;
    }
    if (raw !== path) {
      if (apply) {
        const { error: updErr } = await supabase.from("entries")
          .update({ metadata: { ...e.metadata, file_url: path } }).eq("id", e.id);
        if (updErr) { console.error(`✗ ссылка ${e.id}: ${updErr.message}`); continue; }
      }
      rewrites++;
    }
  }

  // 2. Скрины фидбека.
  const { data: fb } = await supabase.from("feedback")
    .select("id, screenshot_url").not("screenshot_url", "is", null);
  let fbRegs = 0, fbRewrites = 0;
  for (const f of (fb ?? []) as Array<{ id: string; screenshot_url: string }>) {
    const path = storagePathFromLink(f.screenshot_url);
    if (!path) continue;
    if (apply) {
      const { error: regErr } = await supabase.from("storage_files")
        .upsert({ path, bucket: PRIVATE_BUCKET, owner_kind: "feedback", entry_id: null }, { onConflict: "path" });
      if (regErr) { console.error(`✗ реестр скрина ${path}: ${regErr.message}`); continue; }
    }
    fbRegs++;
    if (f.screenshot_url !== path) {
      if (apply) {
        const { error: updErr } = await supabase.from("feedback")
          .update({ screenshot_url: path }).eq("id", f.id);
        if (updErr) { console.error(`✗ ссылка скрина ${f.id}: ${updErr.message}`); continue; }
      }
      fbRewrites++;
    }
  }

  console.log(`${apply ? "Записано" : "[сухой прогон] записал бы"}:`);
  console.log(`  реестр — ${regs} вложений + ${fbRegs} скринов`);
  console.log(`  ссылок переписано — ${rewrites} в entries + ${fbRewrites} в feedback`);
  if (skipped) console.log(`  пропущено (внешние ссылки, не наши файлы) — ${skipped}`);
}

// ── verify ───────────────────────────────────────────────────────────────────
type Check = { missing: Obj[]; stillUrl: string[]; unregistered: string[]; orphans: Obj[]; total: number };

// Одна проверка на две фазы: verify показывает её человеку, cleanup ею же защищается.
// Разные проверки в этих двух местах — как раз то, из-за чего оригиналы удалились при
// незаполненном реестре (проверено на контуре 17.09.2026).
async function collectCheck(): Promise<Check> {
  const src = await listAll(SOURCE_BUCKET);
  const dst = new Map((await listAll(PRIVATE_BUCKET)).map((o) => [o.path, o]));
  const missing = src.filter((o) => dst.get(o.path)?.size !== o.size);

  const { data: regRows, error: regErr } = await supabase.from("storage_files").select("path");
  if (regErr) {
    console.error(`Реестр недоступен (${regErr.message}).`);
    Deno.exit(1);
  }
  const registered = new Set(((regRows ?? []) as Array<{ path: string }>).map((r) => r.path));

  const { data: entries } = await supabase.from("entries")
    .select("id, metadata").not("metadata->>file_url", "is", null);
  const unregistered: string[] = [];
  const stillUrl: string[] = [];
  for (const e of (entries ?? []) as Array<{ id: string; metadata: Record<string, unknown> }>) {
    const raw = e.metadata?.file_url;
    const path = storagePathFromLink(raw);
    if (!path) continue;
    if (typeof raw === "string" && raw !== path) stillUrl.push(e.id);
    if (!registered.has(path)) unregistered.push(path);
  }
  const orphans = src.filter((o) => !registered.has(o.path));
  return { missing, stillUrl, unregistered, orphans, total: src.length };
}

async function verifyPhase() {
  const c = await collectCheck();
  console.log(`Копии на месте: ${c.total - c.missing.length}/${c.total}`);
  if (c.missing.length) console.log(`  ✗ не перенесены: ${c.missing.slice(0, 10).map((o) => o.path).join(", ")}${c.missing.length > 10 ? " …" : ""}`);
  console.log(`Ссылок ещё в старом виде (URL вместо пути): ${c.stillUrl.length}`);
  console.log(`Файлов записей вне реестра (будут 404 на /file): ${c.unregistered.length}`);
  if (c.unregistered.length) console.log(`  ${c.unregistered.slice(0, 10).join(", ")}${c.unregistered.length > 10 ? " …" : ""}`);
  console.log(`Объектов без владельца (перенесены, но показать их некому): ${c.orphans.length}`);

  const ok = !c.missing.length && !c.stillUrl.length && !c.unregistered.length;
  console.log(ok ? "\n✅ Готово к удалению оригиналов." : "\n⛔ Оригиналы удалять НЕЛЬЗЯ.");
  if (!ok) Deno.exit(1);
}

// ── cleanup ──────────────────────────────────────────────────────────────────
async function cleanupPhase() {
  if (!verified) {
    console.error("Удаление оригиналов — только после verify и с флагом --i-verified.");
    Deno.exit(1);
  }
  // Флаг --i-verified подтверждает осознанность, но НЕ заменяет проверку: удалять оригиналы,
  // пока ссылки или реестр не готовы, значит оставить людей без доступа к их же файлам.
  const c = await collectCheck();
  if (c.missing.length || c.stillUrl.length || c.unregistered.length) {
    console.error(`⛔ Удаление отменено: копий нет у ${c.missing.length}, ссылок в старом виде ${c.stillUrl.length}, вне реестра ${c.unregistered.length}. Сначала verify.`);
    Deno.exit(1);
  }
  const src = await listAll(SOURCE_BUCKET);
  const dst = new Map((await listAll(PRIVATE_BUCKET)).map((o) => [o.path, o]));
  const safe = src.filter((o) => dst.get(o.path)?.size === o.size);
  if (!apply) {
    console.log(`[сухой прогон] удалил бы из ${SOURCE_BUCKET}: ${safe.length} объектов`);
    return;
  }
  for (let i = 0; i < safe.length; i += 50) {
    const batch = safe.slice(i, i + 50).map((o) => o.path);
    const { error } = await supabase.storage.from(SOURCE_BUCKET).remove(batch);
    if (error) { console.error(`✗ удаление партии: ${error.message}`); Deno.exit(1); }
  }
  console.log(`Удалено из публичного бакета: ${safe.length}. Ассеты рекордера не тронуты.`);
}

const phases: Record<string, () => Promise<void>> = {
  plan: planPhase,
  init: initPhase,
  copy: copyPhase,
  backfill: backfillPhase,
  verify: verifyPhase,
  cleanup: cleanupPhase,
};
const run = phases[phase];
if (!run) {
  console.error(`Неизвестная фаза "${phase}". Доступны: ${Object.keys(phases).join(", ")}`);
  Deno.exit(1);
}
await run();
