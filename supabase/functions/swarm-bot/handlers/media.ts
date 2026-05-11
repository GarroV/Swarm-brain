import { getEmbedding } from "../lib/openai.ts";
import { saveEntry, generateSummary } from "../lib/storage.ts";
import { sendMessage, getTelegramFileUrl } from "../lib/telegram.ts";
import { uploadToDrive } from "../lib/drive.ts";
import { TgMessage } from "../lib/types.ts";
// @ts-ignore - esm.sh module
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

async function transcribeAudio(fileId: string): Promise<string> {
  const fileUrl = await getTelegramFileUrl(fileId);
  const audioRes = await fetch(fileUrl);
  const audioBuffer = await audioRes.arrayBuffer();

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), "audio.ogg");
  form.append("model", "whisper-1");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Whisper error");
  return data.text;
}

async function describeImage(fileId: string): Promise<string> {
  const fileUrl = await getTelegramFileUrl(fileId);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Опиши подробно содержимое этого изображения на русском языке. Если есть текст — выпиши его полностью." },
          { type: "image_url", image_url: { url: fileUrl } },
        ],
      }],
      max_tokens: 1000,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Vision error");
  return data.choices[0].message.content;
}

// ── URL fetching ──────────────────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/i;

export function extractUrl(text: string): string | null {
  return text.match(URL_REGEX)?.[0] ?? null;
}

async function fetchUrlContent(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; SwarmBot/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/")) throw new Error("Ресурс не является текстовой страницей");

  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 15000);
}

// ── File type constants and helpers ───────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".log", ".json", ".xml", ".yaml", ".yml", ".toml", ".ini", ".env", ".ts", ".js", ".py", ".html", ".htm", ".css"]);

function getFileExt(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

function isTextFile(mime: string, name: string): boolean {
  if (mime.startsWith("text/")) return true;
  if (["application/json", "application/xml"].includes(mime)) return true;
  return TEXT_EXTENSIONS.has(getFileExt(name));
}

const SPREADSHEET_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.ms-excel.sheet.macroEnabled.12",
]);
const SPREADSHEET_EXTS = new Set([".xlsx", ".xls", ".ods", ".xlsm"]);

function isSpreadsheet(mime: string, name: string): boolean {
  return SPREADSHEET_MIMES.has(mime) || SPREADSHEET_EXTS.has(getFileExt(name));
}

function parseSpreadsheet(buffer: ArrayBuffer): string {
  // @ts-ignore - XLSX types not available locally
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", sheetStubs: true });
  const parts: string[] = [];
  // @ts-ignore
  for (const sheetName of wb.SheetNames) {
    // @ts-ignore
    const csv: string = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName], { blankrows: false });
    const trimmed = csv.trim();
    if (trimmed) parts.push(`=== Лист: ${sheetName} ===\n${trimmed}`);
  }
  return parts.join("\n\n");
}

export async function handleDocument(chatId: number, username: string, doc: NonNullable<TgMessage["document"]>): Promise<void> {
  const mime = doc.mime_type ?? "";
  const name = doc.file_name ?? "файл";

  if (isTextFile(mime, name)) {
    await sendMessage(chatId, `Читаю файл <b>${name}</b>...`);
    const fileUrl = await getTelegramFileUrl(doc.file_id);
    const res = await fetch(fileUrl);
    const buffer = await res.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(buffer);
    if (!text.trim()) { await sendMessage(chatId, "Файл пустой."); return; }

    const [driveLink, summary] = await Promise.all([
      uploadToDrive(name, buffer, mime || "text/plain", "Documents"),
      generateSummary(text),
    ]);

    const CHUNK = 3000, OVL = 200;
    const chunks: string[] = [];
    for (let p = 0; p < text.length; p += CHUNK - OVL) chunks.push(text.slice(p, p + CHUNK));
    let firstId = "";
    for (let i = 0; i < chunks.length; i++) {
      const eid = await saveEntry(chunks[i], username, "document",
        { file_name: name, mime: mime || "text/plain", chunk: i + 1, total_chunks: chunks.length, drive_link: driveLink },
        i === 0 ? (summary ?? undefined) : undefined,
      );
      if (i === 0) firstId = eid;
    }
    const driveMsg = driveLink ? `\n<a href="${driveLink}">Открыть на Google Drive</a>` : "";
    const summaryMsg = summary ? `\n\n<b>Тезисы:</b>\n${summary}` : "";
    await sendMessage(chatId, `✅ Файл <b>${name}</b> сохранён (${text.length} символов).${summaryMsg}${driveMsg}`);
    // DISABLED: await analyzeAndCreateTasks(text.slice(0, 6000), chatId, firstId);
    return;
  }

  if (isSpreadsheet(mime, name)) {
    await sendMessage(chatId, `Обрабатываю таблицу <b>${name}</b>...`);
    const fileUrl = await getTelegramFileUrl(doc.file_id);
    const res = await fetch(fileUrl);
    const buffer = await res.arrayBuffer();

    const driveLink = await uploadToDrive(name, buffer, mime || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Documents");

    let extracted: string;
    try {
      extracted = parseSpreadsheet(buffer);
    } catch {
      const driveMsg = driveLink ? ` Файл сохранён на <a href="${driveLink}">Google Drive</a>.` : "";
      await sendMessage(chatId, `Не удалось прочитать таблицу (повреждённый файл?).${driveMsg}`);
      return;
    }

    if (!extracted.trim()) {
      const driveMsg = driveLink ? ` Файл сохранён на <a href="${driveLink}">Google Drive</a>.` : "";
      await sendMessage(chatId, `Таблица пустая или все листы без данных.${driveMsg}`);
      return;
    }

    const summary = await generateSummary(extracted);

    const CHUNK = 3000, OVL = 200;
    const chunks: string[] = [];
    for (let p = 0; p < extracted.length; p += CHUNK - OVL) chunks.push(extracted.slice(p, p + CHUNK));

    let firstId = "";
    for (let i = 0; i < chunks.length; i++) {
      const eid = await saveEntry(chunks[i], username, "document",
        { file_name: name, mime: mime || "spreadsheet", chunk: i + 1, total_chunks: chunks.length, drive_link: driveLink },
        i === 0 ? (summary ?? undefined) : undefined,
      );
      if (i === 0) firstId = eid;
    }

    const driveMsg = driveLink ? `\n<a href="${driveLink}">Открыть на Google Drive</a>` : "";
    const summaryMsg = summary ? `\n\n<b>Тезисы:</b>\n${summary}` : "";
    await sendMessage(chatId, `✅ Таблица <b>${name}</b> сохранена (${extracted.length} символов).${summaryMsg}${driveMsg}`);
    // DISABLED: await analyzeAndCreateTasks(extracted.slice(0, 6000), chatId, firstId);
    return;
  }

  if (mime === "application/pdf" || getFileExt(name) === ".pdf") {
    await sendMessage(chatId, `Обрабатываю PDF <b>${name}</b>...`);
    const fileUrl = await getTelegramFileUrl(doc.file_id);
    const pdfRes = await fetch(fileUrl);
    const pdfBuffer = await pdfRes.arrayBuffer();
    const driveLink = await uploadToDrive(name, pdfBuffer, "application/pdf", "Documents");

    const raw = new TextDecoder("latin1").decode(pdfBuffer);
    const streams: string[] = [];
    const streamMatches = raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g);
    for (const m of streamMatches) {
      const chunk = m[1].replace(/[^\x20-\x7E\n]/g, " ").replace(/\s+/g, " ").trim();
      if (chunk.length > 20) streams.push(chunk);
    }

    const btMatches = raw.matchAll(/BT([\s\S]*?)ET/g);
    const btTexts: string[] = [];
    for (const m of btMatches) {
      const tjMatches = m[1].matchAll(/\(([^)]+)\)\s*Tj/g);
      for (const t of tjMatches) btTexts.push(t[1]);
    }

    const extracted = btTexts.length > 0
      ? btTexts.join(" ").trim()
      : streams.join("\n").trim();

    if (!extracted || extracted.length < 50) {
      await sendMessage(chatId, "Не удалось извлечь текст из PDF — возможно, это скан. Попробуй скопировать текст вручную через /add.");
      return;
    }

    const summary = await generateSummary(extracted);

    const CHUNK_SIZE = 3000;
    const OVERLAP = 200;
    const chunks: string[] = [];
    let pos = 0;
    while (pos < extracted.length) {
      chunks.push(extracted.slice(pos, pos + CHUNK_SIZE));
      pos += CHUNK_SIZE - OVERLAP;
    }

    let firstEntryId = "";
    for (let i = 0; i < chunks.length; i++) {
      const entryId = await saveEntry(chunks[i], username, "pdf",
        { file_name: name, chunk: i + 1, total_chunks: chunks.length, drive_link: driveLink },
        i === 0 ? (summary ?? undefined) : undefined,
      );
      if (i === 0) firstEntryId = entryId;
    }

    const drivePdfMsg = driveLink ? `\n<a href="${driveLink}">Открыть на Google Drive</a>` : "";
    const summaryMsg = summary ? `\n\n<b>Тезисы:</b>\n${summary}` : "";
    await sendMessage(chatId, `✅ PDF <b>${name}</b> сохранён (${chunks.length} частей).${summaryMsg}${drivePdfMsg}`);
    // DISABLED: await analyzeAndCreateTasks(extracted.slice(0, 6000), chatId, firstEntryId);
    return;
  }

  await sendMessage(chatId, `Формат <code>${mime || name}</code> пока не поддерживается.\n\nПоддерживаемые форматы: TXT, MD, CSV, JSON, XLSX, PDF.`);
}

export async function handlePhoto(chatId: number, username: string, photos: NonNullable<TgMessage["photo"]>): Promise<void> {
  await sendMessage(chatId, "Анализирую изображение...");
  const largest = photos.reduce((a, b) => ((b.file_size ?? 0) > (a.file_size ?? 0) ? b : a));
  const description = await describeImage(largest.file_id);
  const entryId = await saveEntry(description, username, "image");
  await sendMessage(chatId, `Изображение обработано и сохранено:\n\n<i>${description.slice(0, 500)}${description.length > 500 ? "..." : ""}</i>`);
  // DISABLED: await analyzeAndCreateTasks(description, chatId, entryId);
}

export async function handleUrl(chatId: number, username: string, url: string): Promise<void> {
  await sendMessage(chatId, `Загружаю страницу...`);
  const content = await fetchUrlContent(url);
  if (!content || content.length < 50) { await sendMessage(chatId, "Не удалось извлечь текст со страницы."); return; }
  const entryId = await saveEntry(content, username, "url", { url });
  await sendMessage(chatId, `Страница сохранена (${content.length} символов):\n<code>${url}</code>`);
  // DISABLED: await analyzeAndCreateTasks(content, chatId, entryId);
}

export async function handleVoice(chatId: number, username: string, fileId: string, duration: number): Promise<void> {
  await sendMessage(chatId, `Транскрибирую голосовое (${duration} сек)...`);
  const transcript = await transcribeAudio(fileId);
  const summary = await generateSummary(transcript);
  const entryId = await saveEntry(transcript, username, "voice", {}, summary ?? undefined);
  await sendMessage(chatId, summary
    ? `✅ Сохранено.\n\n<b>Тезисы:</b>\n${summary}`
    : `✅ Транскрипция сохранена:\n\n<i>${transcript.slice(0, 500)}</i>`);
  // DISABLED: await analyzeAndCreateTasks(transcript, chatId, entryId);
}
