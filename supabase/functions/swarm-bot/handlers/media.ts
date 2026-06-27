import { saveEntry, generateSummary, uploadToStorage } from "../lib/storage.ts"; // generateSummary used for multi-chunk docs only
import { sendMessage, getTelegramFileUrl } from "../lib/telegram.ts";
import { TgMessage } from "../lib/types.ts";
import { isWhisperHallucination, WHISPER_HALLUCINATION_RE } from "../../_shared/whisper-hallucinations.ts";
// @ts-ignore - esm.sh module
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

async function transcribeAudio(fileId: string): Promise<string> {
  const tgUrl = await getTelegramFileUrl(fileId);
  const audioRes = await fetch(tgUrl);
  const audioBuffer = await audioRes.arrayBuffer();

  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), "audio.ogg");
  form.append("model", "whisper-1");
  // verbose_json → сегменты с no_speech_prob/avg_logprob: тот же фильтр галлюцинаций, что у встреч
  // (тишина в голосовом так же даёт ютуб-«титры», которые иначе ушли бы в базу как есть).
  form.append("response_format", "verbose_json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Whisper error");
  const segments = (data.segments ?? []) as Array<{ text: string; no_speech_prob?: number; avg_logprob?: number }>;
  const clean = segments
    .filter((s) => !isWhisperHallucination(s.text ?? "", s.no_speech_prob ?? 0, s.avg_logprob ?? 0))
    .map((s) => s.text.trim())
    .join(" ")
    .trim();
  if (clean) return clean;
  // Сегментов не было/всё вычищено — фолбэк на плоский text, но не если он сам галлюцинация.
  const flat = (data.text ?? "").trim();
  return WHISPER_HALLUCINATION_RE.test(flat) ? "" : flat;
}

async function describeImage(fileId: string): Promise<string> {
  const tgUrl = await getTelegramFileUrl(fileId);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Опиши подробно содержимое этого изображения на русском языке. Если есть текст — выпиши его полностью." },
          { type: "image_url", image_url: { url: tgUrl } },
        ],
      }],
      max_tokens: 1000,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "Vision error");
  return data.choices[0].message.content;
}

export { extractUrl } from "../lib/intent.ts";

// ─────────────────────────────────────────────────────────────────────────────
// SSRF guard
//
// fetchUrlContent lets an authenticated allowed_user make the bot fetch an
// arbitrary URL. On Supabase Edge infra that is a real SSRF target: cloud
// metadata endpoints (169.254.169.254), internal services, loopback, etc.
// We block non-HTTP(S) schemes and any host that resolves to a
// private/reserved IP, and we re-validate every redirect hop.
//
// KNOWN, ACCEPTED LIMITATION (DNS-rebinding TOCTOU): we resolve the host to
// IPs and validate them, then call fetch() which resolves DNS again. The two
// resolutions are not guaranteed to return the same address, so a hostile
// resolver could return a public IP to us and an internal IP to fetch().
// Deno's fetch does not support pinning the connection to a vetted IP, so we
// cannot fully close this without a custom HTTP client. Given the endpoint is
// auth-gated to allowed_users, this residual risk is accepted.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_REDIRECT_HOPS = 5;

/** Parse a dotted-quad IPv4 string into its 4 octets, or null if malformed. */
function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets as [number, number, number, number];
}

/** True if the given IPv4 dotted-quad falls in a private/reserved range. */
function isBlockedIpv4(ip: string): boolean {
  const octets = parseIpv4Octets(ip);
  if (!octets) return true; // unparseable → treat as blocked
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 127) return true; // 127.0.0.0/8 (loopback)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local, incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && octets[2] === 0) return true; // 192.0.0.0/24 (IETF protocol assignments)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmarking)
  if (a >= 224 && a <= 239) return true; // 224.0.0.0/4 (multicast)
  if (a >= 240) return true; // 240.0.0.0/4 (reserved) — also covers 255.255.255.255
  return false;
}

// Expand an IPv6 literal (compressed/full, optional trailing dotted-quad) into 8
// 16-bit groups. null if malformed (caller fails closed). Needed because WHATWG URL
// canonicalizes ::ffff:1.2.3.4 → ::ffff:HHHH:HHHH, so a trailing-dotted-quad regex
// alone misses IPv4-mapped literals (an SSRF bypass).
function expandIpv6(input: string): number[] | null {
  let s = input.toLowerCase();
  // Fold a trailing embedded IPv4 (::ffff:1.2.3.4 / ::1.2.3.4) into two hex groups.
  const dq = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dq && dq.index !== undefined) {
    const o = parseIpv4Octets(dq[1]);
    if (!o) return null;
    s = s.slice(0, dq.index) + (((o[0] << 8) | o[1]).toString(16)) + ":" + (((o[2] << 8) | o[3]).toString(16));
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  if (halves.length === 2) {
    const head = parse(halves[0]);
    const tail = parse(halves[1]);
    if (!head || !tail) return null;
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    return [...head, ...Array(fill).fill(0), ...tail];
  }
  const all = parse(s);
  return all && all.length === 8 ? all : null;
}

/**
 * Pure predicate: is `ip` a private/reserved/internal address that must not be
 * fetched? Handles IPv4 dotted-quad, IPv6 (full expansion), and IPv4 embedded in
 * IPv6 (mapped ::ffff:, NAT64 64:ff9b::, deprecated ::compat).
 * Unparseable input is treated as blocked (fail-closed).
 */
export function isBlockedIp(ip: string): boolean {
  if (!ip) return true;
  let host = ip.trim();
  // Strip zone id (e.g. fe80::1%eth0) and surrounding brackets.
  host = host.replace(/^\[/, "").replace(/\]$/, "");
  const zoneIdx = host.indexOf("%");
  if (zoneIdx >= 0) host = host.slice(0, zoneIdx);

  // IPv4 literal.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return isBlockedIpv4(host);

  // IPv6 (anything containing a colon).
  if (host.includes(":")) {
    const h = expandIpv6(host);
    if (!h) return true; // malformed IPv6 → fail-closed
    const [h0, h1, h2, h3, h4, h5, h6, h7] = h;
    const embeddedV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    const top5Zero = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0;
    // IPv4-mapped ::ffff:a.b.c.d (incl. WHATWG hex form ::ffff:HHHH:HHHH) → apply v4 rules.
    if (top5Zero && h5 === 0xffff) return isBlockedIpv4(embeddedV4(h6, h7));
    // NAT64 64:ff9b::/96 → embedded IPv4.
    if (h0 === 0x0064 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) return isBlockedIpv4(embeddedV4(h6, h7));
    // Loopback ::1 and unspecified :: (before the v4-compat catch below).
    if (top5Zero && h5 === 0 && h6 === 0 && (h7 === 0 || h7 === 1)) return true;
    // IPv4-compatible (deprecated) ::a.b.c.d → embedded IPv4.
    if (top5Zero && h5 === 0) return isBlockedIpv4(embeddedV4(h6, h7));
    // fc00::/7 (ULA); fe80::/10 (link-local) + fec0::/10 (deprecated site-local) = 0xfe80..0xfeff.
    if (h0 >= 0xfc00 && h0 <= 0xfdff) return true;
    if (h0 >= 0xfe80 && h0 <= 0xfeff) return true;
    return false;
  }

  // Not an IP literal we recognize — caller should resolve it via DNS.
  // Reaching here with a non-IP means fail-closed.
  return true;
}

/** True if the hostname is an IP literal (v4 dotted-quad, hex/octal/dec v4 is
 *  already normalized to dotted-quad by WHATWG URL, or bracketed/bare IPv6). */
function isIpLiteral(hostname: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  return hostname.includes(":"); // IPv6 literal (URL.hostname keeps it unbracketed)
}

/**
 * Validate that `url` is a safe public HTTP(S) target. Throws a clear Error on
 * any violation (bad scheme, IP-literal pointing at a reserved range, hostname
 * resolving to a blocked IP, or DNS failure). Returns the parsed URL on success.
 */
export async function assertSafePublicUrl(url: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Некорректный URL");
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Запрещённый протокол: ${u.protocol}`);
  }

  // WHATWG URL normalizes IPv4 literals (decimal/octal/hex) into dotted-quad in
  // u.hostname, so the literal-IP path below catches 2130706433 / 0x7f000001 etc.
  const host = u.hostname;

  if (isIpLiteral(host)) {
    if (isBlockedIp(host)) {
      throw new Error(`Запрещённый адрес назначения: ${host}`);
    }
    return u;
  }

  // DNS name → resolve A and AAAA; reject if ANY resolved IP is blocked.
  const resolved: string[] = [];
  for (const recordType of ["A", "AAAA"] as const) {
    try {
      const ips = await Deno.resolveDns(host, recordType);
      resolved.push(...ips);
    } catch {
      // NXDOMAIN for one family is normal; ignore here and check the union below.
    }
  }

  if (resolved.length === 0) {
    throw new Error(`Не удалось разрешить имя хоста: ${host}`);
  }
  for (const ip of resolved) {
    if (isBlockedIp(ip)) {
      throw new Error(`Хост ${host} указывает на внутренний адрес: ${ip}`);
    }
  }
  return u;
}

async function fetchUrlContent(url: string): Promise<string> {
  let current = await assertSafePublicUrl(url);
  let res: Response | null = null;

  // Manual redirect loop: validate every hop so a public→internal redirect
  // cannot bypass the guard above.
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    res = await fetch(current.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SwarmBot/1.0)" },
      redirect: "manual",
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) break; // 3xx without Location — treat as final response.
      // Drain the redirect body so the connection can be reused/closed.
      await res.body?.cancel();
      if (hop === MAX_REDIRECT_HOPS) {
        throw new Error("Слишком много перенаправлений");
      }
      // Resolve relative redirects against the current URL, then re-validate.
      const next = new URL(location, current).toString();
      current = await assertSafePublicUrl(next);
      continue;
    }
    break;
  }

  if (!res) throw new Error("Не удалось загрузить страницу");
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
  // @ts-ignore
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

export async function handleDocument(chatId: number, username: string, doc: NonNullable<TgMessage["document"]>, groupId: string): Promise<void> {
  const mime = doc.mime_type ?? "";
  const name = doc.file_name ?? "файл";

  if (isTextFile(mime, name)) {
    await sendMessage(chatId, `Читаю файл <b>${name}</b>...`);
    const tgUrl = await getTelegramFileUrl(doc.file_id);
    const res = await fetch(tgUrl);
    const buffer = await res.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(buffer);
    if (!text.trim()) { await sendMessage(chatId, "Файл пустой."); return; }

    const [stored, summary] = await Promise.all([
      uploadToStorage(name, buffer, mime || "text/plain", "documents"),
      generateSummary(text),
    ]);

    const CHUNK = 3000, OVL = 200;
    const chunks: string[] = [];
    for (let p = 0; p < text.length; p += CHUNK - OVL) chunks.push(text.slice(p, p + CHUNK));
    for (let i = 0; i < chunks.length; i++) {
      await saveEntry(chunks[i], username, "document",
        { file_name: name, mime: mime || "text/plain", chunk: i + 1, total_chunks: chunks.length, file_url: stored.url },
        i === 0 ? (summary ?? undefined) : undefined,
        groupId,
      );
    }
    const fileMsg = stored.url ? `\n📎 <a href="${stored.url}">Скачать файл</a>` : (stored.error ? `\n⚠️ Storage: ${stored.error}` : "");
    const summaryMsg = summary ? `\n\n<b>Тезисы:</b>\n${summary}` : "";
    await sendMessage(chatId, `✅ Файл <b>${name}</b> сохранён (${text.length} символов).${summaryMsg}${fileMsg}`);
    return;
  }

  if (isSpreadsheet(mime, name)) {
    await sendMessage(chatId, `Обрабатываю таблицу <b>${name}</b>...`);
    const tgUrl = await getTelegramFileUrl(doc.file_id);
    const res = await fetch(tgUrl);
    const buffer = await res.arrayBuffer();
    const stored = await uploadToStorage(name, buffer, mime || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "spreadsheets");

    let extracted: string;
    try {
      extracted = parseSpreadsheet(buffer);
    } catch {
      const fileMsg = stored.url ? ` <a href="${stored.url}">Скачать файл</a>.` : (stored.error ? ` ⚠️ Storage: ${stored.error}` : "");
      await sendMessage(chatId, `Не удалось прочитать таблицу.${fileMsg}`);
      return;
    }

    if (!extracted.trim()) {
      const fileMsg = stored.url ? ` <a href="${stored.url}">Скачать файл</a>.` : "";
      await sendMessage(chatId, `Таблица пустая или все листы без данных.${fileMsg}`);
      return;
    }

    const summary = await generateSummary(extracted);
    const CHUNK = 3000, OVL = 200;
    const chunks: string[] = [];
    for (let p = 0; p < extracted.length; p += CHUNK - OVL) chunks.push(extracted.slice(p, p + CHUNK));
    for (let i = 0; i < chunks.length; i++) {
      await saveEntry(chunks[i], username, "document",
        { file_name: name, mime: mime || "spreadsheet", chunk: i + 1, total_chunks: chunks.length, file_url: stored.url },
        i === 0 ? (summary ?? undefined) : undefined,
        groupId,
      );
    }
    const fileMsg = stored.url ? `\n📎 <a href="${stored.url}">Скачать файл</a>` : (stored.error ? `\n⚠️ Storage: ${stored.error}` : "");
    const summaryMsg = summary ? `\n\n<b>Тезисы:</b>\n${summary}` : "";
    await sendMessage(chatId, `✅ Таблица <b>${name}</b> сохранена (${extracted.length} символов).${summaryMsg}${fileMsg}`);
    return;
  }

  if (mime === "application/pdf" || getFileExt(name) === ".pdf") {
    await sendMessage(chatId, `Обрабатываю PDF <b>${name}</b>...`);
    const tgUrl = await getTelegramFileUrl(doc.file_id);
    const pdfRes = await fetch(tgUrl);
    const pdfBuffer = await pdfRes.arrayBuffer();
    const stored = await uploadToStorage(name, pdfBuffer, "application/pdf", "pdfs");

    if (!stored.url) {
      await sendMessage(chatId, `⚠️ Не удалось сохранить PDF: ${stored.error ?? "неизвестная ошибка"}`);
      return;
    }

    await saveEntry(`PDF файл: ${name}`, username, "pdf", { file_name: name, file_url: stored.url }, undefined, groupId);
    await sendMessage(chatId, `✅ PDF <b>${name}</b> сохранён.\n📎 <a href="${stored.url}">Скачать файл</a>`);
    return;
  }

  await sendMessage(chatId, `Формат <code>${mime || name}</code> пока не поддерживается.\n\nПоддерживаемые форматы: TXT, MD, CSV, JSON, XLSX, PDF.`);
}

export async function handlePhoto(chatId: number, username: string, photos: NonNullable<TgMessage["photo"]>, groupId: string): Promise<void> {
  await sendMessage(chatId, "Анализирую изображение...");
  const largest = photos.reduce((a, b) => ((b.file_size ?? 0) > (a.file_size ?? 0) ? b : a));
  const description = await describeImage(largest.file_id);
  await saveEntry(description, username, "image", undefined, undefined, groupId);
  await sendMessage(chatId, `Изображение обработано и сохранено:\n\n<i>${description.slice(0, 500)}${description.length > 500 ? "..." : ""}</i>`);
}

export async function handleUrl(chatId: number, username: string, url: string, rawText: string, analyze: boolean, groupId: string): Promise<void> {
  if (analyze) {
    await sendMessage(chatId, `Загружаю страницу...`);
    try {
      const content = await fetchUrlContent(url);
      if (!content || content.length < 50) { await sendMessage(chatId, "Не удалось извлечь текст со страницы."); return; }
      await saveEntry(content, username, "url", { url }, undefined, groupId);
      await sendMessage(chatId, `Страница сохранена (${content.length} символов):\n<code>${url}</code>`);
    } catch (err) {
      await sendMessage(chatId, `Не удалось загрузить страницу: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    const description = rawText.replace(url, "").replace(/^(добавь в базу[:\s]*|сохрани[:\s]*|добавь[:\s]*)/i, "").trim();
    const title = description || url;
    const content = description ? `${description}\n\nСсылка: ${url}` : url;

    // Реальные тезисы и keywords (синонимы для поиска) сгенерит buildEntryIndex из content.
    // Отдельный «синоним-индекс» не делаем: он дублировал keywords и лез в видимый summary.
    await saveEntry(content, username, "link", { url, title }, undefined, groupId);
    await sendMessage(chatId, `🔗 Ссылка сохранена.\n<code>${url}</code>${description ? `\n\n<i>${description}</i>` : ""}`);
  }
}

export async function handleVoice(chatId: number, username: string, fileId: string, duration: number, groupId: string): Promise<void> {
  await sendMessage(chatId, `Транскрибирую голосовое (${duration} сек)...`);
  const transcript = await transcribeAudio(fileId);
  // Пусто = речь не распозналась (тишина/шум; галлюцинации-«титры» вычищены) — не сохраняем мусор.
  if (!transcript.trim()) {
    await sendMessage(chatId, "🔇 Не удалось распознать речь — запись не сохранена. Попробуй записать заново, ближе к микрофону.");
    return;
  }
  const { summary } = await saveEntry(transcript, username, "voice", {}, undefined, groupId);
  await sendMessage(chatId, summary
    ? `✅ Сохранено.\n\n<b>Тезисы:</b>\n${summary}`
    : `✅ Транскрипция сохранена:\n\n<i>${transcript.slice(0, 500)}</i>`);
}
