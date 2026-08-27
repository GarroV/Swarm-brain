import { supabase, ADMIN_USER_ID, isAdminUser } from "./lib/supabase.ts";
import { sendMessage, sendInlineMessage, editInlineMessage, buildKeyboard, answerCallback, getBotUsername } from "./lib/telegram.ts";
import { gateGroupMessage } from "./lib/group-gate.ts";
import { autoSyncProfile, getSession, clearSession } from "./lib/storage.ts";
import { checkAllowedWithGroup } from "./lib/workspace.ts";
import { getReadAiToken } from "./lib/readai.ts";
import { handleAdd, handleAsk } from "./handlers/knowledge.ts";
import { handleVoice, handleDocument, handlePhoto, handleUrl } from "./handlers/media.ts";
import { classifyEntryCommand, parseManageCommand, extractUrl, parseSaveCommand, parseCreateTaskCommand } from "./lib/intent.ts";
import { ALL_MEETING_SOURCES, ENTRY_MEETING_SOURCES, sourceLabel } from "../_shared/sources.ts";
import { buildClaudeProjectPrompt } from "../_shared/claude-project-prompt.ts";
import { handleEntryCommand, handleManageCallbacks, handleManageSessionInput } from "./handlers/manage.ts";
import { handleTaskCallbacks, handleTasks, handleAddTask, handleTaskSessionInput, handleQuickCreateTask } from "./tasks/index.ts";
import { handleMeetings, handleMeetingCallbacks, handleMeetingSessionInput } from "./handlers/meetings.ts";
import { handleUsers, handleUserCallbacks, handleUserSessionInput, handleBroadcast } from "./handlers/users.ts";
import { handleGranolaCallbacks, handleGranolaCommand, handleGranolaSessionInput, pollGranolaForUser, ingestNewGranolaNotesAllUsers } from "./handlers/granola.ts";
import { handleFeedbackCommand, handleFeedbackCallbacks, handleFeedbackPhoto, handleFeedbackSessionInput, cleanupOldFeedback } from "./handlers/feedback.ts";
import { handleWorkspace } from "./handlers/workspace.ts";
import { handleSuperadmin, handleSuperadminCallbacks, handleSuperadminSession } from "./handlers/superadmin.ts";
import { sendAllDigests, generatePersonalDigest } from "./handlers/digest.ts";
import { sendDailyReport } from "./handlers/daily-report-send.ts";
import { sendReviewReminders } from "./handlers/review-reminders-send.ts";
import { sendTaskPings } from "./handlers/task-pings-send.ts";
import { getHelpText, helpKeyboard, guideMenu, guideStep } from "./handlers/help.ts";
import { mintMcpToken, buildSetupOneLiner, hasActiveMcpToken, mintRecorderToken, buildRecorderSetupOneLiner, hasActiveRecorderToken } from "./lib/mcp-setup.ts";
import type { TgMessage, TgCallbackQuery } from "./lib/types.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
// Эндпоинт MCP-сервера для ручного подключения (веб-коннектор claude.ai: URL + Bearer-токен).
const SWARM_MCP_URL = "https://vbqglndbxkpmreccpqmr.supabase.co/functions/v1/swarm-mcp";

// ── Background runner — returns 200 to Telegram immediately, processes async ──

function bgRun(promise: Promise<void>, chatId: number): void {
  const safe = promise.catch(async (err) => {
    await sendMessage(chatId, `Ошибка обработки: ${err instanceof Error ? err.message : String(err)}`);
  });
  // @ts-ignore - Supabase Edge Runtime API
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(safe);
}

// Минтит и показывает новый MCP-токен (общий путь для /mytoken и подтверждённого перевыпуска).
async function sendMyToken(chatId: number, userId: number): Promise<void> {
  const minted = await mintMcpToken(userId);
  if (!minted) {
    await sendMessage(chatId, "❌ Не удалось сгенерировать токен. Обратись к администратору.");
    return;
  }
  await sendMessage(chatId,
    `🔑 <b>Твой токен для Claude Desktop</b>\n\n` +
    `<code>${minted.token}</code>\n` +
    `<i>👆 Нажми на токен — скопируется целиком.</i>\n\n` +
    `Токен <b>бессрочный</b>. Сохрани — повторно не покажу. Потеряешь — запусти /mytoken снова (старый перестанет работать).\n\n` +
    `Проще: /setup — подключит Claude Desktop автоматически, без ручной возни.\n\n` +
    `Отозвать прямо сейчас: /revoketoken`
  );
}

// Минтит MCP-токен и присылает однострочник установки Claude Desktop (общий путь для /setup
// и подтверждённого переподключения setup_reissue). Перевыпуск УБИВАЕТ старый токен — поэтому
// /setup зовёт это молча только при ПЕРВОМ подключении (когда активного токена ещё нет).
async function sendSetupOneLiner(chatId: number, userId: number): Promise<void> {
  const minted = await mintMcpToken(userId);
  if (!minted) {
    await sendMessage(chatId, "❌ Не удалось подготовить подключение. Попробуй позже или напиши администратору.");
    return;
  }
  await sendMessage(chatId,
    `<b>🖥 Подключаем Claude Desktop за один шаг</b> (macOS)\n\n` +
    `1️⃣ Открой приложение <b>Терминал</b>\n` +
    `<i>(⌘+Пробел → набери «Терминал» → Enter)</i>\n\n` +
    `2️⃣ Вставь эту команду (⌘+V) и нажми Enter:\n\n` +
    `<code>${buildSetupOneLiner(minted.token)}</code>\n\n` +
    `3️⃣ Подожди — скрипт сам поставит всё нужное и перезапустит Claude. Готово ✅\n\n` +
    `<i>В команде твой личный токен (бессрочный). Никому не пересылай. Отозвать: /revoketoken.</i>\n\n` +
    `Текст инструкций для проекта Claude → /claude`
  );
}

// Минтит токен рекордера и присылает готовый однострочник установки (общий путь для
// /recordertoken и подтверждённого перевыпуска rtk_reissue). Мгновенный сетап как у /setup:
// одна команда в Терминале — поставит и настроит рекордер сам.
async function sendRecorderToken(chatId: number, userId: number): Promise<void> {
  const minted = await mintRecorderToken(userId);
  if (!minted) {
    await sendMessage(chatId, "❌ Не удалось сгенерировать токен рекордера. Обратись к администратору.");
    return;
  }
  const expStr = minted.expiresAt.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
  await sendMessage(chatId,
    `<b>🎙 Подключаем рекордер встреч за один шаг</b> (macOS)\n\n` +
    `Одна команда — скрипт сам поставит рекордер, подпишет и пропишет токен. Пароль может спросить только установка Command Line Tools (если их ещё нет на маке).\n\n` +
    `1️⃣ Открой приложение <b>Терминал</b>\n` +
    `<i>(⌘+Пробел → набери «Терминал» → Enter)</i>\n\n` +
    `2️⃣ Вставь эту команду (⌘+V) и нажми Enter:\n\n` +
    `<code>${buildRecorderSetupOneLiner(minted.token)}</code>\n\n` +
    `3️⃣ Приложение откроется само. Выдай разрешение: System Settings → Privacy → «Screen &amp; System Audio Recording» → включи SwarmRecorder, затем ⌘Q и открой заново. Готово ✅\n\n` +
    `Токен действует до <b>${expStr}</b>. Это <b>отдельный</b> токен — перевыпуск /mytoken для Claude Desktop его НЕ трогает. Никому не пересылай. Отозвать: /revokerecordertoken.\n\n` +
    `<i>Вручную: вставь токен <code>${minted.token}</code> в рекордере — иконка в меню-баре → «Вставить токен из буфера».</i>`
  );
}

// ── Watchdog: спасаем встречи, навсегда застрявшие в «Тезисы готовятся…» ─────────
// Два класса застреваний:
//  (1) summary_status='processing' без прогресса. Durable-обработка (meeting-process) бьёт
//      heartbeat last_progress_at на каждой готовой части → здоровую длинную встречу убивать
//      НЕЛЬЗЯ. Валим в 'failed' только по ЗАСТОЮ (нет прогресса дольше staleMinutes), уведомляем.
//  (2) ПРИЗРАКИ: summary_status=null без transcript/process_state — claim был, а ingest не отработал
//      (напр. совсем пустая запись: ни mic, ни system). UI поллит «готовятся» вечно. Старые такие
//      метим 'failed' (без Telegram — обработка даже не начиналась), чтобы UI перестал ждать.
// Фолбэк на updated_at — для строк без heartbeat (легаси). Идемпотентно.
async function sweepStuckMeetings(staleMinutes = 15): Promise<number> {
  const cutoffMs = Date.now() - staleMinutes * 60_000;
  const cutoffIso = new Date(cutoffMs).toISOString();
  let swept = 0;

  type Recorder = { telegram_id: number };
  type Row = { id: string; title: string | null; recorders: Recorder[] | null; last_progress_at: string | null; updated_at: string | null };

  // (1) Зависшие в processing — по застою heartbeat.
  const { data: rows } = await supabase
    .from("meetings")
    .select("id, title, recorders, last_progress_at, updated_at")
    .eq("summary_status", "processing");
  const note =
    "⚠️ Не удалось обработать запись встречи — обработка превысила лимит времени. " +
    "Попробуй записать заново (по возможности короче).";
  for (const m of (rows ?? []) as Row[]) {
    const beat = m.last_progress_at ?? m.updated_at;
    if (!beat || new Date(beat).getTime() >= cutoffMs) continue; // прогресс свежий → встреча живая
    await supabase
      .from("meetings")
      .update({ summary_status: "failed", processing_lease: null, updated_at: new Date().toISOString() })
      .eq("id", m.id);
    swept++;
    for (const r of m.recorders ?? []) {
      if (!r || typeof r.telegram_id !== "number") continue;
      try {
        await sendMessage(r.telegram_id, note);
      } catch (e) {
        console.error(`sweepStuckMeetings: notify failed for ${m.id} / ${r.telegram_id}:`, e);
      }
    }
  }

  // (2) Призраки: claim был, ingest не отработал. Метим 'failed' (без уведомления), чтобы UI
  // перестал поллить. Узкие гарды: пусто (нет transcript/notes/state), не опубликовано, старше cutoff.
  const { data: ghosts } = await supabase
    .from("meetings")
    .select("id")
    .is("summary_status", null)
    .is("transcript", null)
    .is("process_state", null)
    .is("draft_notes_md", null)
    .is("entry_id", null)
    .lt("created_at", cutoffIso);
  for (const g of (ghosts ?? []) as { id: string }[]) {
    await supabase.from("meetings").update({ summary_status: "failed", updated_at: new Date().toISOString() }).eq("id", g.id);
    swept++;
  }

  return swept;
}

// ── Watchdog рекордера: алерт на АНОМАЛИЮ, не на тишину ───────────────────────────
// Read.ai-watchdog («давно не было встреч») убран как ложный шум: нет созвонов ≠ поломка.
// Здесь — только сигналы, где молчание = реальная проблема. Данные пишет meeting-heartbeat.
const RECORDER_STALE_MIN = 20; // тик heartbeat = 15 мин → живой рекордер всегда свежее 20
async function checkRecorderHealth(): Promise<void> {
  const staleIso = new Date(Date.now() - RECORDER_STALE_MIN * 60_000).toISOString();

  // (1) Оборванная запись: рекордер писал (recording=true), но перестал пинговать >STALE.
  //     При штатной остановке пришёл бы heartbeat recording=false → застрявший true = краш
  //     приложения во время записи (аудио, скорее всего, не загрузилось). Сброс флага = дедуп.
  const { data: crashed } = await supabase
    .from("allowed_users")
    .select("telegram_id")
    .eq("recorder_last_recording", true)
    .lt("recorder_last_seen", staleIso);
  for (const u of (crashed ?? []) as { telegram_id: number }[]) {
    await supabase.from("allowed_users").update({ recorder_last_recording: false }).eq("telegram_id", u.telegram_id);
    try {
      await sendMessage(u.telegram_id,
        "⚠️ <b>Похоже, запись встречи прервалась</b> — рекордер писал встречу, но перестал отвечать " +
        "(возможно, приложение закрылось). Проверь, что SwarmRecorder запущен, и при необходимости запиши заново.");
    } catch (e) { console.error(`checkRecorderHealth signal1 ${u.telegram_id}:`, e); }
  }

  // (2) Токен рекордера истекает <7 дней и ещё не предупреждали (дедуп через recorder_expiry_warned,
  //     сброс при перевыпуске в mintRecorderToken). Детерминированно, без ложных срабатываний.
  const soonIso = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const nowIso = new Date().toISOString();
  const { data: expiring } = await supabase
    .from("allowed_users")
    .select("telegram_id, recorder_token_expires_at")
    .eq("recorder_expiry_warned", false)
    .not("recorder_token_hash", "is", null)
    .not("recorder_token_expires_at", "is", null)
    .lt("recorder_token_expires_at", soonIso)
    .gt("recorder_token_expires_at", nowIso);
  for (const u of (expiring ?? []) as { telegram_id: number; recorder_token_expires_at: string }[]) {
    const days = Math.max(1, Math.ceil((new Date(u.recorder_token_expires_at).getTime() - Date.now()) / 86_400_000));
    await supabase.from("allowed_users").update({ recorder_expiry_warned: true }).eq("telegram_id", u.telegram_id);
    try {
      await sendMessage(u.telegram_id,
        `🎙 <b>Токен рекордера истекает через ${days} дн.</b> Чтобы запись встреч не прервалась — ` +
        `переустанови рекордер: /recordertoken.`);
    } catch (e) { console.error(`checkRecorderHealth signal2 ${u.telegram_id}:`, e); }
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return new Response("Bad Request", { status: 400 }); }

  // ── Cron triggers (требуют X-Cron-Secret) ────────────────────────────────────
  if (body.setup_commands === true || body.digest_cron === true || body.daily_report_cron === true || body.review_reminders_cron === true || body.task_pings_cron === true || body.feedback_retention_cron === true || body.readai_token_refresh === true || body.granola_poll === true || body.meetings_watchdog === true || body.webhook_info === true || body.set_webhook === true) {
    if (!CRON_SECRET || req.headers.get("X-Cron-Secret") !== CRON_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }
  }
  // ── Вебхук: диагностика и переустановка (X-Cron-Secret) ─────────────────────
  // Зачем: если Telegram перестаёт доставлять апдейты, снаружи это НЕ ВИДНО — функция жива и
  // отвечает 200 на прямой POST, а сообщения людей просто не приходят, и бот молча «не отвечает».
  // Проверить это можно только у Telegram (getWebhookInfo), а для запроса нужен токен бота,
  // который лежит в секретах Edge Functions и наружу не отдаётся. Поэтому спрашиваем изнутри.
  // Токен в ответ НЕ попадает: Telegram возвращает только url/ошибки/счётчик очереди.
  if (body.webhook_info === true) {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
    return new Response(await res.text(), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  // Переустановка вебхука на саму эту функцию. URL берём из окружения, а НЕ из тела запроса —
  // иначе триггер стал бы способом увести все сообщения команды на чужой адрес.
  if (body.set_webhook === true) {
    const target = `${Deno.env.get("SUPABASE_URL")}/functions/v1/swarm-bot`;
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: target, allowed_updates: ["message", "callback_query"] }),
    });
    const json = await res.json();
    return new Response(JSON.stringify({ target, telegram: json }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  if (body.setup_commands === true) {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: [
        // Бот — точка быстрого доступа: в МЕНЮ команд оставлены только «Добавить» и «Спросить»
        // (решение владельца 2026-08-09). Остальные команды СКРЫТЫ из меню, но их обработчики
        // живы дальше по файлу — работают при ручном вводе и вернутся в меню позже.
        // Чтобы вернуть команду в меню — раскомментировать её строку.
        { command: "add", description: "Добавить запись в базу знаний" },
        { command: "ask", description: "Задать вопрос" },
        // { command: "start", description: "Главное меню" },
        // { command: "tasks", description: "Задачи команды" },
        // { command: "addtask", description: "Добавить задачу" },
        // { command: "meetings", description: "Встречи на подтверждение" },
        // { command: "status", description: "Состояние базы знаний" },
        // { command: "digest", description: "Личный дайджест" },
        // { command: "setup", description: "Подключить Claude Desktop (авто)" },
        // { command: "recordertoken", description: "🎙 Рекордер встреч (Mac) — установка" },
        // { command: "help", description: "Справка" },
        // { command: "feedback", description: "Отправить фидбек" },
        // { command: "reset", description: "Сбросить состояние бота" },
      ]}),
    });
    const json = await res.json();
    return new Response(JSON.stringify(json), { status: 200 });
  }

  if (body.digest_cron === true) {
    await sendAllDigests(7);
    return new Response("OK", { status: 200 });
  }

  if (body.daily_report_cron === true) {
    await sendDailyReport();
    return new Response("OK", { status: 200 });
  }

  if (body.review_reminders_cron === true) {
    await sendReviewReminders();
    return new Response("OK", { status: 200 });
  }

  if (body.task_pings_cron === true) {
    const sent = await sendTaskPings();
    return new Response(`OK: ${sent} pings sent`, { status: 200 });
  }

  if (body.feedback_retention_cron === true) {
    const removed = await cleanupOldFeedback();
    return new Response(`OK: ${removed} old feedback purged`, { status: 200 });
  }

  if (body.granola_poll === true) {
    const count = await ingestNewGranolaNotesAllUsers();
    await sweepStuckMeetings();
    await checkRecorderHealth();
    return new Response(`OK: ${count} new granola meetings`, { status: 200 });
  }

  if (body.meetings_watchdog === true) {
    const n = await sweepStuckMeetings();
    await checkRecorderHealth();
    return new Response(JSON.stringify({ ok: true, swept: n }), { status: 200 });
  }

  if (body.readai_token_refresh === true) {
    // Read.ai отключается (READ_AI_ENABLED off, не развивается). Когда фича выключена — cron
    // no-op: не рефрешим токен и НЕ шлём watchdog-алерт «встречи не поступают / проверь вебхук
    // Read.ai» (он ложный — Read.ai-встреч и не должно быть). Вернуть фичу → снять этот гейт.
    if (Deno.env.get("READ_AI_ENABLED") !== "true") {
      return new Response("OK: read.ai disabled, skipped", { status: 200 });
    }
    await getReadAiToken();
    // Check if meetings are still coming in — alert if last one is >3 days ago
    const { data: lastMeeting } = await supabase
      .from("entries").select("created_at").eq("source", "read_ai")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (lastMeeting) {
      const hoursAgo = (Date.now() - new Date(lastMeeting.created_at).getTime()) / 3_600_000;
      if (hoursAgo > 72) {
        await sendMessage(
          ADMIN_USER_ID,
          `⚠️ <b>Встречи не поступают</b> — последняя была ${Math.round(hoursAgo / 24)} дн назад.\n\nПроверь вебхук в настройках Read.ai.`
        );
      }
    }
    return new Response("OK", { status: 200 });
  }

  const update = body as { message?: TgMessage; callback_query?: TgCallbackQuery };

  // ── Callback query (inline button press) ────────────────────────────────────
  if (update.callback_query) {
    const cb = update.callback_query;
    const userId = cb.from.id ?? 0;
    const username = cb.from.username ?? String(userId);
    const chatId = cb.message.chat.id;

    await answerCallback(cb.id);

    const { allowed: cbAllowed, groupId: cbGroupId } = await checkAllowedWithGroup(userId);
    if (!cbAllowed) return new Response("OK", { status: 200 });

    await autoSyncProfile(userId, cb.from.first_name, cb.from.last_name, cb.from.username);

    try {
      if (cb.data === "mtk_reissue") {
        await sendMyToken(chatId, userId);
        return new Response("OK", { status: 200 });
      }

      if (cb.data === "setup_reissue") {
        await sendSetupOneLiner(chatId, userId);
        return new Response("OK", { status: 200 });
      }

      if (cb.data === "rtk_reissue") {
        await sendRecorderToken(chatId, userId);
        return new Response("OK", { status: 200 });
      }

      // Мастер настройки (саморедактируемое сообщение). guide_open — прислать НОВОЕ меню
      // (из-под справки); guide_menu — вернуть текущее сообщение в меню; guide_s1/2/3 — шаг.
      if (cb.data === "guide_open") {
        const m = guideMenu();
        await sendInlineMessage(chatId, m.text, m.keyboard);
        return new Response("OK", { status: 200 });
      }
      if (cb.data === "guide_menu") {
        const m = guideMenu();
        await editInlineMessage(chatId, cb.message.message_id, m.text, m.keyboard);
        return new Response("OK", { status: 200 });
      }
      if (cb.data === "guide_s1" || cb.data === "guide_s2" || cb.data === "guide_s3") {
        const s = guideStep(Number(cb.data.slice(-1)) as 1 | 2 | 3);
        await editInlineMessage(chatId, cb.message.message_id, s.text, s.keyboard);
        return new Response("OK", { status: 200 });
      }

      const saHandled = await handleSuperadminCallbacks(cb, chatId, userId);
      if (saHandled) return new Response("OK", { status: 200 });

      if (await handleTaskCallbacks(cb, chatId, userId, username, cbGroupId)) {
        // handled
      } else if (await handleMeetingCallbacks(cb, chatId, userId, username, cbGroupId)) {
        // handled
      } else if (await handleUserCallbacks(cb, chatId, userId, cbGroupId)) {
        // handled
      } else if (await handleGranolaCallbacks(cb, chatId, userId, username)) {
        // handled
      } else if (await handleFeedbackCallbacks(cb, chatId, userId, username)) {
        // handled
      } else if (await handleManageCallbacks(cb, chatId, userId, username, cbGroupId)) {
        // handled
      }
    } catch (err) {
      await sendMessage(chatId, `Ошибка: ${err instanceof Error ? err.message : String(err)}`);
    }

    return new Response("OK", { status: 200 });
  }

  // ── Message ────────────────────────────────────────────────────────────────
  const message = update.message;
  if (!message) return new Response("OK", { status: 200 });

  const chatId = message.chat.id;
  const userId = message.from?.id ?? 0;
  const username = message.from?.username ?? String(userId);

  // ── Группы: без явного обращения не отвечаем ──────────────────────────────
  // В группе/супергруппе обрабатываем только команду или @упоминание бота (гейт
  // вырезает упоминание из текста); медиа и болтовня игнорируются молча. Личка — как раньше.
  let gatedText: string | undefined;
  if (message.chat.type && message.chat.type !== "private") {
    const verdict = gateGroupMessage(message.text, await getBotUsername());
    if (!verdict.process) return new Response("OK", { status: 200 });
    gatedText = verdict.text;
  }

  const { allowed, groupId } = await checkAllowedWithGroup(userId, message.from?.username);
  if (!allowed) {
    await sendMessage(chatId, "Доступ запрещён. Обратитесь к администратору.");
    return new Response("OK", { status: 200 });
  }

  await autoSyncProfile(userId, message.from?.first_name, message.from?.last_name, message.from?.username);

  try {
    if (message.voice) { await handleVoice(chatId, username, message.voice.file_id, message.voice.duration, groupId); return new Response("OK", { status: 200 }); }
    if (message.audio) { await handleVoice(chatId, username, message.audio.file_id, 0, groupId); return new Response("OK", { status: 200 }); }
    if (message.document) { await handleDocument(chatId, username, message.document, groupId); return new Response("OK", { status: 200 }); }
    if (message.photo?.length) {
      const photoSession = await getSession(chatId);
      if (photoSession?.action === "feedback_photo") {
        await handleFeedbackPhoto(chatId, userId, username, message.photo);
      } else {
        await handlePhoto(chatId, username, message.photo, groupId);
      }
      return new Response("OK", { status: 200 });
    }

    const text = (gatedText ?? message.text)?.trim();
    if (!text) return new Response("OK", { status: 200 });

    const BUTTON_LABELS = new Set(["📥 Добавить", "❓ Спросить", "📋 Задачи", "ℹ️ Помощь", "👥 Пользователи", "🎙 Встречи", "🎙 Read.ai"]);
    const isButtonPress = BUTTON_LABELS.has(text);
    const isCommand = text.startsWith("/") || isButtonPress;

    if (!isCommand) {
      const session = await getSession(chatId);
      const action = session?.action ?? null;

      // Пересланное сообщение = контент на сохранение, а не вопрос. Детерминированный
      // сигнал от Telegram (forward_origin/legacy-поля) — НЕ отдаём решение LLM.
      const isForward = Boolean(
        message.forward_origin || message.forward_date || message.forward_from || message.forward_from_chat,
      );

      // Ждём новое значение для замены записи — весь текст/URL = новое значение.
      if (action === "manage_replace") {
        await handleManageSessionInput(chatId, userId, action, text, session?.context ?? undefined, groupId);
        return new Response("OK", { status: 200 });
      }

      // Намерение управления записью: «удали/замени запись …» → структурный флоу
      // (поиск → подтверждение → действие). Перехватывает до URL-сейва.
      const entryCmd = classifyEntryCommand(text);
      if (entryCmd) {
        const parsed = parseManageCommand(text)!;
        await handleEntryCommand(chatId, userId, parsed.query, entryCmd, groupId, parsed.newValue);
        return new Response("OK", { status: 200 });
      }

      const url = extractUrl(text);
      if (url && text.length < 300) {
        const analyze = /посмотри|проанализируй|прочитай|загрузи|открой|что тут|что здесь|что это|summarize|analyze/i.test(text);
        await handleUrl(chatId, username, url, text, analyze, groupId);
        return new Response("OK", { status: 200 });
      }

      if (action && action.startsWith("sa_")) {
        await handleSuperadminSession(chatId, action, text, userId);
      } else if (action === "waiting_add") {
        await clearSession(chatId);
        await handleAdd(chatId, username, text, groupId);
      } else if (action === "waiting_ask") {
        await clearSession(chatId);
        await handleAsk(chatId, text, userId, groupId);
      } else if (action && await handleMeetingSessionInput(chatId, action, text, groupId)) {
        // meeting session handled
      } else if (action && await handleUserSessionInput(chatId, userId, action, text)) {
        // user session handled
      } else if (action && await handleTaskSessionInput(chatId, userId, action, text, session?.context ?? undefined, groupId)) {
        // task session handled
      } else if (action && await handleGranolaSessionInput(chatId, userId, action, text)) {
        // granola session handled
      } else if (action && await handleFeedbackSessionInput(chatId, action, text)) {
        // feedback session handled
      } else if (isForward) {
        // Форвард → всегда сохраняем (сразу + тезисы), минуя LLM-угадайку.
        await handleAdd(chatId, username, text, groupId);
      } else {
        // Порядок: создать задачу ("добавь задачу: …") → сохранить ("сохрани:", "добавь в базу:")
        // → иначе текст = вопрос/поиск. Всё детерминированно, без LLM-угадайки.
        const createTaskCmd = parseCreateTaskCommand(text);
        const saveContent = createTaskCmd ? null : parseSaveCommand(text);
        if (createTaskCmd) {
          await handleQuickCreateTask(chatId, userId, groupId, createTaskCmd);
        } else if (saveContent !== null) {
          await handleAdd(chatId, username, saveContent || text, groupId);
        } else if (text.length >= 3) {
          await handleAsk(chatId, text, userId, groupId);
        }
      }
      return new Response("OK", { status: 200 });
    }

    // Commands
    const [command, ...rest] = text.split(/\s+/);
    const argText = isButtonPress ? "" : rest.join(" ");
    await clearSession(chatId);

    if (command === "/reset") {
      await clearSession(chatId);
      await sendMessage(chatId, "🔄 Сброс выполнен. Бот готов к работе.");
    } else if (command === "/start") {
      await clearSession(chatId);
      await sendMessage(chatId,
        `<b>Swarm Brain</b> — командная база знаний и задачи.\n\n` +
        `Напиши вопрос — найду ответ по базе. Чтобы сохранить: кнопка 📥 <b>Добавить</b>, либо пришли 🎤 голос · 📎 файл · 🔗 ссылку · пересланное сообщение.\n\n` +
        `🌐 <b>Swarm Brain</b> — приложение: задачи, встречи, поиск.\n` +
        `🔗 https://swarm-brain.pages.dev — вход через Telegram, ставится как приложение (Dock / экран «Домой»).\n\n` +
        `🎙 <b>Рекордер встреч (Mac):</b> /recordertoken → приложение встанет в /Applications. Затем привяжи Google-календарь в Swarm Brain → Настройки → Google Calendar (без него рекордер не видит встреч).\n\n` +
        `🖥 <b>Claude Desktop:</b> /setup — подключить автоматически.\n\n` +
        `📖 /help — полная справка`,
        buildKeyboard()
      );
      // Register bot commands in side menu (idempotent)
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands: [
          { command: "start", description: "Главное меню" },
          { command: "add", description: "Добавить запись в базу знаний" },
          { command: "ask", description: "Задать вопрос" },
          { command: "tasks", description: "Задачи команды" },
          { command: "addtask", description: "Добавить задачу" },
          { command: "meetings", description: "Встречи на подтверждение" },
          { command: "users", description: "Управление командой" },
          { command: "status", description: "Состояние базы знаний" },
          { command: "setup", description: "Подключить Claude Desktop (авто)" },
          { command: "help", description: "Справка" },
          { command: "feedback", description: "Отправить фидбек" },
          { command: "reset", description: "Сбросить состояние бота" },
          { command: "connect_claude", description: "Как подключить Claude Desktop" },
          { command: "claude", description: "Инструкции для проекта Claude Desktop" },
        ]}),
      });
    } else if (command === "/help" || text === "ℹ️ Помощь") {
      // Справка с inline-кнопкой «⚙️ Настроить систему» (→ мастер настройки, callback guide_open).
      await sendInlineMessage(chatId, getHelpText(), helpKeyboard());
    } else if (command === "/add" || text === "📥 Добавить") {
      await handleAdd(chatId, username, argText, groupId);
    } else if (command === "/ask" || text === "❓ Спросить") {
      await handleAsk(chatId, argText.trim() ? argText : "", userId, groupId);
    } else if (command === "/users" || text === "👥 Пользователи") {
      await handleUsers(chatId, userId, argText, groupId);
    } else if (command === "/tasks" || text === "📋 Задачи") {
      await handleTasks(chatId, userId, argText, groupId);
    } else if (command === "/addtask") {
      await handleAddTask(chatId);
    } else if (command === "/meetings" || text === "🎙 Встречи") {
      await pollGranolaForUser(chatId, userId);
      const { data: meetings } = await supabase
        .from("entries")
        .select("id, metadata, created_at, source, owner_id")
        .eq("group_id", groupId)
        .in("source", ENTRY_MEETING_SOURCES)
        .or("metadata->>confirmed.is.null,metadata->>confirmed.eq.false")
        // Видимость: только свои + не-приватные (чужие приватные встречи не показываем).
        .or(`is_private.eq.false,owner_id.eq.${userId}`)
        .order("created_at", { ascending: false })
        .limit(20);
      if (!meetings?.length) {
        await sendMessage(chatId, "✅ Все встречи подтверждены, новых нет.");
      } else {
        await sendMessage(chatId, `<b>📋 Встречи — ожидают проверки (${meetings.length})</b>\nОткрой каждую, проверь тезисы и подтверди:`);
        const rows = meetings as Array<{ id: string; metadata: Record<string, unknown>; created_at: string; source: string; owner_id: number | null }>;
        // Имена владельцев (owner_id → имя) одним батчем — пометка «от кого пришла запись».
        const ownerIds = [...new Set(rows.map((m) => m.owner_id).filter((x): x is number => typeof x === "number"))];
        const nameById = new Map<number, string>();
        if (ownerIds.length) {
          const [{ data: profs }, { data: aus }] = await Promise.all([
            supabase.from("user_profiles").select("telegram_id, first_name, last_name").in("telegram_id", ownerIds),
            supabase.from("allowed_users").select("telegram_id, username").in("telegram_id", ownerIds),
          ]);
          const unameById = new Map<number, string>(
            ((aus ?? []) as Array<{ telegram_id: number; username: string | null }>)
              .filter((u) => u.username).map((u) => [u.telegram_id, u.username as string]),
          );
          for (const p of (profs ?? []) as Array<{ telegram_id: number; first_name: string | null; last_name: string | null }>) {
            const full = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
            if (full) nameById.set(p.telegram_id, full);
          }
          for (const id of ownerIds) {
            if (!nameById.has(id) && unameById.has(id)) nameById.set(id, `@${unameById.get(id)}`);
          }
        }
        for (const m of rows) {
          const title = (m.metadata?.title as string) ?? "Без названия";
          const entryDate = (m.metadata?.entry_date as string) ?? m.created_at.split("T")[0];
          const dateStr = new Date(`${entryDate}T12:00:00`).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
          const src = m.source === "granola" ? "📓" : "📹";
          const owner = m.owner_id != null ? (nameById.get(m.owner_id) ?? "неизвестно") : null;
          await sendInlineMessage(chatId, `${src} <b>${title}</b>\n📅 ${dateStr}${owner ? ` · 🧑 ${owner}` : ""}`, [[
            { text: "🔍 Тезисы", callback_data: `mr_${m.id}` },
            { text: "🗑", callback_data: `md_${m.id}` },
          ]]);
        }
      }
    } else if (command === "/granola") {
      await handleGranolaCommand(chatId, userId);
    } else if (command === "/connect") {
      const [service, apiKey] = argText.trim().split(/\s+/);
      if (!service || !apiKey) {
        await sendMessage(chatId, "Использование: <code>/connect granola ВАШ_КЛЮЧ</code>");
      } else if (service.toLowerCase() !== "granola") {
        await sendMessage(chatId, `Неизвестный сервис: <code>${service}</code>. Доступно: granola`);
      } else {
        await sendMessage(chatId, "Проверяю ключ...");
        const testRes = await fetch("https://public-api.granola.ai/v1/notes?limit=1", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!testRes.ok) {
          await sendMessage(chatId, "❌ Ключ не подошёл. Проверь правильность и попробуй снова.");
        } else {
          await supabase.from("user_integrations").upsert(
            { telegram_id: userId, service: "granola", api_key: apiKey, last_polled_at: new Date().toISOString() },
            { onConflict: "telegram_id,service" }
          );
          await sendMessage(chatId, "✅ <b>Granola подключена!</b>\n\nТеперь новые встречи будут прилетать автоматически раз в час.\nИли используй /granola для ручного импорта.");
        }
      }
    } else if (command === "/disconnect") {
      const service = argText.trim().toLowerCase();
      if (!service) {
        await sendMessage(chatId, "Использование: <code>/disconnect granola</code>");
      } else {
        const { error } = await supabase.from("user_integrations")
          .delete().eq("telegram_id", userId).eq("service", service);
        if (error) {
          await sendMessage(chatId, `Ошибка: ${error.message}`);
        } else {
          await sendMessage(chatId, `✅ <b>${service}</b> отключена.`);
        }
      }
    } else if (command === "/superadmin") {
      await handleSuperadmin(chatId, userId);
    } else if (command === "/workspace") {
      await handleWorkspace(chatId, userId, argText);
    } else if (command === "/broadcast") {
      await handleBroadcast(chatId, userId, argText, groupId);
    } else if (command === "/feedback") {
      await handleFeedbackCommand(chatId);
    } else if (command === "/digest") {
      bgRun(generatePersonalDigest(chatId, userId, 7, groupId), chatId);
    } else if (command === "/report") {
      if (!(await isAdminUser(userId))) {
        await sendMessage(chatId, "Команда доступна только администратору.");
      } else {
        bgRun(sendDailyReport(), chatId);
      }
    } else if (command === "/setup") {
      // Уже подключён? НЕ перевыпускаем молча — новый токен убьёт рабочий config.json на
      // другом Mac. Это была частая причина «токен протух»: повторный /setup рвал живое
      // подключение. Просим подтверждение — как /mytoken и /recordertoken.
      if (await hasActiveMcpToken(userId)) {
        await sendInlineMessage(chatId,
          `🖥 <b>Claude Desktop уже подключён.</b>\n\n` +
          `✅ Работает — <b>ничего делать не нужно</b>.\n\n` +
          `⚠️ Claude пишет <b>«Invalid token»</b> / не видит базу, или ставишь на <b>новый Mac</b>? ` +
          `Жми — переустановлю с новым токеном. Прежний Mac после этого перестанет видеть базу, пока не переустановишь и там.`,
          [[{ text: "🔄 Всё равно переподключить", callback_data: "setup_reissue" }]]
        );
      } else {
        await sendSetupOneLiner(chatId, userId);
      }
    } else if (command === "/mytoken") {
      // Ручной токен (для тех, кто настраивает config сам). Авто-путь — /setup.
      // Если живой токен уже есть — НЕ перевыпускаем молча (это убьёт рабочий config.json).
      // Предупреждаем и просим явного подтверждения.
      if (await hasActiveMcpToken(userId)) {
        await sendInlineMessage(chatId,
          `🔑 <b>Токен в базе есть и активен.</b>\n\n` +
          `✅ Claude отвечает по базе — ничего делать не нужно.\n\n` +
          `⚠️ Claude пишет <b>«Invalid token»</b> / «токен протух» / не видит базу, или подключаешь <b>новое устройство</b>? ` +
          `Значит в настройках Claude лежит <b>старый</b> токен. Жми кнопку — выдам свежий, вставь его в ` +
          `claude.ai → Settings → Connectors → Bearer (или в config.json). На Mac проще — /setup.\n\n` +
          `<i>Свежий токен убьёт старый — обнови его во всех местах, где вставлял.</i>`,
          [[{ text: "🔄 Выдать свежий токен", callback_data: "mtk_reissue" }]]
        );
      } else {
        await sendMyToken(chatId, userId);
      }
    } else if (command === "/revoketoken") {
      const { error: revErr } = await supabase
        .from("allowed_users")
        .update({ claude_mcp_token_hash: null, claude_mcp_token_expires_at: null })
        .eq("telegram_id", userId);
      if (revErr) {
        await sendMessage(chatId, "❌ Не удалось отозвать токен. Попробуй позже.");
      } else {
        await sendMessage(chatId, "🔒 <b>Токен отозван.</b> Доступ к Swarm Brain из Claude закрыт. Новый — через /mytoken.");
      }
    } else if (command === "/recordertoken") {
      // Отдельный токен для рекордера встреч (desktop-agent), независимый от /mytoken.
      // Мгновенный сетап как /setup: одна команда в Терминале ставит и настраивает рекордер.
      // Если живой токен уже есть — НЕ перевыпускаем молча (это убьёт авторизацию рекордера).
      // Предупреждаем и просим явного подтверждения (зеркало mtk_reissue для Claude Desktop).
      if (await hasActiveRecorderToken(userId)) {
        await sendInlineMessage(chatId,
          `🎙 <b>У тебя уже есть активный токен рекордера.</b>\n\n` +
          `Если рекордер уже подключён — он <b>работает</b>, делать ничего не нужно.\n\n` +
          `Перевыпуск нужен, только если ты <b>потерял</b> токен или подозреваешь <b>утечку</b>. ` +
          `Он <b>убьёт старый</b> — придётся заново прогнать установку рекордера.`,
          [[{ text: "🔄 Всё равно перевыпустить", callback_data: "rtk_reissue" }]]
        );
      } else {
        await sendRecorderToken(chatId, userId);
      }
    } else if (command === "/revokerecordertoken") {
      const { error: rvErr } = await supabase
        .from("allowed_users")
        .update({ recorder_token_hash: null, recorder_token_expires_at: null })
        .eq("telegram_id", userId);
      await sendMessage(chatId, rvErr ? "❌ Не удалось отозвать." : "🔒 <b>Токен рекордера отозван.</b> Новый — через /recordertoken.");
    } else if (command === "/connect_claude") {
      await sendMessage(chatId,
        `<b>🖥 Как подключить Claude к базе знаний</b>\n\n` +
        `<b>Вариант A — Claude Desktop (приложение на Mac)</b>\n` +
        `Команда /setup пришлёт одну строчку для Терминала — она поставит и настроит всё сама. Ничего вручную трогать не нужно.\n\n` +
        `<b>Вариант B — Claude в браузере (claude.ai)</b>\n` +
        `1️⃣ Возьми токен: /mytoken\n` +
        `2️⃣ На claude.ai: Settings → Connectors → Add custom connector\n` +
        `3️⃣ URL: <code>${SWARM_MCP_URL}</code>\n` +
        `4️⃣ Authentication → Bearer token → вставь свой токен\n` +
        `5️⃣ Save. Готово.\n\n` +
        `После подключения (любой вариант) создай проект:\n` +
        `Projects → New Project → вставь инструкции из /claude в поле Instructions.\n\n` +
        `<i>Токен протух / «Invalid token»? Он не истекает по времени — обычно это старый токен в настройках. Возьми свежий: /mytoken (или /setup на Mac) и обнови его в коннекторе.</i>`
      );
    } else if (command === "/claude") {
      const instructions = buildClaudeProjectPrompt(userId);

      await sendMessage(chatId,
        `<b>🖥 Claude Desktop — инструкции для проекта</b>\n\n` +
        `Projects → New Project → скопируй в поле <b>Instructions</b>:\n\n` +
        `<code>${instructions}</code>\n\n` +
        `Сервер ещё не подключён? → /setup`
      );
    } else if (command === "/status") {
      const [
        { count: totalMeetings },
        { data: unconfirmed },
        { data: lastMeeting },
        { count: openTasks },
        { count: overdueTasks },
      ] = await Promise.all([
        // Статистика — по ВСЕМ источникам встреч (вкл. опубликованные рекордерные `desktop-agent`);
        // pending-фильтр ниже — только внешние (рекордерные pending живут в таблице `meetings`).
        supabase.from("entries").select("*", { count: "exact", head: true }).eq("group_id", groupId).in("source", ALL_MEETING_SOURCES),
        supabase.from("entries").select("id, metadata, created_at").eq("group_id", groupId).eq("source", "read_ai").eq("metadata->>confirmed", "false").order("created_at", { ascending: false }),
        supabase.from("entries").select("metadata, created_at, source").eq("group_id", groupId).in("source", ALL_MEETING_SOURCES).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("tasks").select("*", { count: "exact", head: true }).eq("group_id", groupId).eq("status", "open").eq("is_private", false),
        supabase.from("tasks").select("*", { count: "exact", head: true }).eq("group_id", groupId).eq("status", "open").eq("is_private", false).lt("due_date", new Date().toISOString().split("T")[0]),
      ]);

      let statusMsg = `<b>📊 Статус Swarm Brain</b>\n\n`;

      statusMsg += `<b>🎙 Встречи</b>\n`;
      statusMsg += `Всего в базе: <b>${totalMeetings ?? 0}</b>\n`;

      const unconfirmedList = (unconfirmed ?? []) as Array<{ id: string; metadata: Record<string, unknown>; created_at: string }>;
      if (unconfirmedList.length > 0) {
        statusMsg += `⏳ Ожидают подтверждения: <b>${unconfirmedList.length}</b>\n`;
        for (const m of unconfirmedList.slice(0, 3)) {
          const title = (m.metadata?.title as string) ?? "Без названия";
          const date = new Date(m.created_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
          statusMsg += `  • ${title} (${date})\n`;
        }
        if (unconfirmedList.length > 3) statusMsg += `  и ещё ${unconfirmedList.length - 3}...\n`;
      } else {
        statusMsg += `✅ Все встречи подтверждены\n`;
      }

      if (lastMeeting) {
        const hoursAgo = Math.round((Date.now() - new Date((lastMeeting as { created_at: string }).created_at).getTime()) / 3_600_000);
        const title = ((lastMeeting as { metadata: Record<string, unknown> }).metadata?.title as string) ?? "Без названия";
        const src = sourceLabel((lastMeeting as { source: string }).source);
        const freshness = hoursAgo < 24 ? `${hoursAgo} ч назад` : `${Math.round(hoursAgo / 24)} дн назад`;
        statusMsg += `Последняя: <b>${title}</b> · ${src} · ${freshness}\n`;
      }

      statusMsg += `\n<b>✅ Задачи</b>\n`;
      statusMsg += `Открытых: <b>${openTasks ?? 0}</b>`;
      if ((overdueTasks ?? 0) > 0) statusMsg += `  ⚠️ Просрочено: <b>${overdueTasks}</b>`;

      await sendMessage(chatId, statusMsg);
    } else {
      await sendMessage(chatId, `Неизвестная команда: <code>${command}</code>\n\nИспользуй /help для списка команд.`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sendMessage(chatId, `Произошла ошибка: ${msg}`);
  }

  return new Response("OK", { status: 200 });
});
