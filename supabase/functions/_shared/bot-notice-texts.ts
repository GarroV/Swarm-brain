// Каталог текстов уведомлений бота: по паре en/ru на каждый отказ. Часть профиля бота
// (bot-profile.ts, D029): тексты правятся здесь, ядро их только рендерит.
//
// Правило проекта: новый пользовательский текст заводится сразу на английском и на русском,
// английский приоритетный. Пустая строка здесь = пустое сообщение в Telegram, то есть ровно
// тот молчаливый отказ, против которого блок и заведён; полноту держит структурный тест
// в notices.test.ts.
//
// Подстановки: {title} (название встречи), {bot} (имя бота из профиля), {door_wait} (сколько
// секунд бот ждёт у двери, из профиля) — имя и тайминг в текст не вписываются, иначе разъедутся
// с профилем молча. Техническая причина (`detail`) добавляется отдельной строкой в renderNotice.
// Разметка — HTML (parse_mode: "HTML"): допустимы <b>, <i>, <code>.
import { BOT_PROFILE } from "./bot-profile.ts";
import type { NoticeKind, NoticeLang } from "./notices.ts";

/** Подставить в шаблон имя бота и тайминг двери из профиля. {title} остаётся рендеру. */
export function fillBotTemplate(template: string): string {
  return template
    .replaceAll("{bot}", BOT_PROFILE.name)
    .replaceAll("{door_wait}", String(BOT_PROFILE.door.waitSeconds));
}

/** Ключ текста. Отличается от kind только у двери: у неё первое сообщение и последнее — разные. */
export type NoticeTextKey = NoticeKind | "door_waiting_last";

export const NOTICE_TEXTS: Record<NoticeTextKey, Record<NoticeLang, string>> = {
  // Бот стоит у двери (профиль: door.waitSeconds), его не впустили. Просит впустить, называет встречу,
  // предупреждает, что напомнит ещё один раз и уйдёт.
  door_waiting: {
    en:
      "<b>{title}</b>: {bot} has been waiting at the door for {door_wait} seconds and nobody has let it in yet. Please admit it now — if it's still stuck, {bot} will remind you once more and then leave without recording.",
    ru:
      "«<b>{title}</b>»: {bot} уже {door_wait} секунд стоит у двери, и его до сих пор не впустили. Впустите бота сейчас — если это не поможет, он напомнит ещё раз и после этого уйдёт без записи.",
  },
  // Тот самый единственный повтор, через door.repeatSeconds профиля. Обязан сказать: это последнее напоминание,
  // бот уходит, встреча записана НЕ будет — если запись нужна, записывайте сами.
  door_waiting_last: {
    en:
      "<b>{title}</b>: this is {bot}'s last reminder — it still hasn't been let in and is leaving now. The meeting will not be recorded; if you need a recording, please make one yourself.",
    ru:
      "«<b>{title}</b>»: это последнее напоминание от {bot} — его так и не впустили, и бот уходит прямо сейчас. Запись вестись не будет; если она нужна, запишите встречу сами.",
  },
  // Хост отклонил вход. Ждать нечего, запись не идёт.
  door_denied: {
    en:
      "<b>{title}</b>: the host declined {bot}'s request to join. There's nothing to wait for — the meeting will not be recorded.",
    ru: "«<b>{title}</b>»: организатор отклонил заявку {bot} на вход. Ждать нечего — запись вестись не будет.",
  },
  // Meet показал «You can't join this video call» ещё до лобби. Никто вход не отклонял: так
  // Google отвечает гостю без аккаунта, когда доступ встречи — «Trusted» (по умолчанию в
  // рабочем домене), и ровно так же — на неверную ссылку. Говорим обе причины и что сделать.
  door_blocked: {
    en:
      "<b>{title}</b>: Google Meet didn't let {bot} in: it showed \"You can't join this video call\" before the waiting room, so nobody even saw a request to join. Usually this means the meeting only admits people with an account from your organization, and {bot} joins as a guest without one. To record this meeting, set Host controls → Meeting access to <b>Open</b> and invite {bot} again; otherwise it will be able to join once it has its own account. If access is already Open, check the meeting link. The meeting will not be recorded.",
    ru:
      "«<b>{title}</b>»: Google Meet не пустил {bot}: ещё до комнаты ожидания он показал «You can't join this video call», так что заявку на вход никто даже не увидел. Обычно это значит, что встреча пускает только людей с аккаунтом вашей организации, а {bot} заходит гостем без аккаунта. Чтобы записать встречу, в настройках организатора поставьте доступ к встрече <b>«Открытый»</b> (Meeting access → Open) и позовите {bot} снова; иначе бот сможет заходить, когда у него появится свой аккаунт. Если доступ уже открытый — проверьте ссылку на встречу. Запись вестись не будет.",
  },
  // Страница прямо говорит, что встречи нет: неверный код или встреча уже закончилась.
  meeting_unavailable: {
    en:
      "<b>{title}</b>: Google Meet says this meeting doesn't exist or has already ended, so {bot} had nowhere to join. Check the meeting link — if the meeting was moved to a new link, invite {bot} with that one. The meeting will not be recorded.",
    ru:
      "«<b>{title}</b>»: Google Meet сообщил, что такой встречи нет или она уже закончилась, — {bot} было некуда заходить. Проверьте ссылку на встречу; если встреча переехала на новую ссылку, позовите {bot} по ней. Запись вестись не будет.",
  },
  // Сохранённый вход аккаунта бота не действует: Google показал страницу входа или попросил
  // подтвердить, что это он. Организатор встречи тут ни при чём — войти заново должен тот, кто
  // ведёт аккаунт бота; пароль бот не вводит и не хранит.
  account_signin_required: {
    en:
      "<b>{title}</b>: {bot} couldn't get to the meeting: Google asked it to sign in to its Google account again (the saved sign-in expired or Google wants to confirm it). This isn't about the meeting's settings — whoever runs {bot} needs to sign the bot in again, then invite it once more. The meeting will not be recorded.",
    ru:
      "«<b>{title}</b>»: {bot} не дошёл до встречи: Google попросил его заново войти в свой аккаунт Google (сохранённый вход истёк или Google хочет его подтвердить). Настройки встречи тут ни при чём — тому, кто ведёт {bot}, нужно войти за бота заново и позвать его ещё раз. Запись вестись не будет.",
  },
  // На входе капча. Бот её не проходит по устройству, ждать бесполезно.
  captcha: {
    en:
      "<b>{title}</b>: {bot} hit a captcha at the door and can't solve it as a device. Waiting won't help — the meeting will not be recorded.",
    ru:
      "«<b>{title}</b>»: на входе {bot} наткнулся на капчу и не может пройти её как устройство. Ждать бесполезно — запись вестись не будет.",
  },
  // В приглашении нет распознаваемой ссылки на звонок — бот не пошёл никуда.
  // Человеку стоит подсказать: добавить ссылку в приглашение.
  no_conference_link: {
    en:
      "<b>{title}</b>: {bot} found no recognizable call link in the invite, so it didn't join anything. Add a direct link to the invite and it will find the meeting next time.",
    ru:
      "«<b>{title}</b>»: в приглашении не нашлось распознаваемой ссылки на звонок, и {bot} никуда не заходил. Добавьте в приглашение прямую ссылку — в следующий раз бот найдёт встречу.",
  },
  // Не удалось определить владельца встречи. Бот НЕ заходит намеренно: запись без владельца
  // не попадёт ни в чью очередь вычитки (принцип приватности).
  no_owner: {
    en:
      "<b>{title}</b>: {bot} couldn't determine who owns this meeting and deliberately skipped it. A recording with no owner would never reach anyone's review queue, so none is made.",
    ru:
      "«<b>{title}</b>»: {bot} не смог определить владельца встречи и намеренно не стал заходить. Запись без владельца всё равно не попала бы ни в чью очередь вычитки, поэтому её просто не делают.",
  },
  // Бот в звонке, но звука нет: запись не начата. Лучше сказать о тишине, чем записать тишину.
  no_audio: {
    en:
      "<b>{title}</b>: {bot} joined but heard no audio at all, so it never started recording. Better to say so than hand you a recording full of silence.",
    ru:
      "«<b>{title}</b>»: {bot} зашёл на встречу, но не услышал никакого звука, и запись не начал. Лучше сказать об этом честно, чем прислать вам тишину вместо записи.",
  },
  // Запись сделана, но не доехала в Swarm (сеть, токен). Сама она в очередь вычитки не придёт.
  recording_lost: {
    en:
      "<b>{title}</b>: {bot} recorded this meeting, but the recording never reached Swarm — likely a network or token issue. It won't appear in the review queue on its own.",
    ru:
      "«<b>{title}</b>»: {bot} записал встречу, но запись не доехала до Swarm — похоже на проблему с сетью или токеном. Сама по себе она в очередь вычитки не попадёт.",
  },
  // Контейнер бота умер посреди встречи: записанное до этого момента может быть неполным.
  container_died: {
    en:
      "<b>{title}</b>: {bot}'s container crashed partway through the meeting. Whatever was recorded up to that point survived, but the recording may be incomplete.",
    ru:
      "«<b>{title}</b>»: контейнер {bot} упал прямо посреди встречи. То, что успело записаться до этого момента, сохранилось, но запись может быть неполной.",
  },
  // Не смог зайти по иной причине. Причина придёт отдельной строкой (detail обязателен).
  join_failed: {
    en:
      "<b>{title}</b>: {bot} could not join for a reason that doesn't fit the usual cases, so no recording was made. See the details below.",
    ru:
      "«<b>{title}</b>»: {bot} не смог зайти по причине, не подпадающей под обычные случаи, поэтому запись не велась. Подробности ниже.",
  },
};

/**
 * Сторож оборванной записи (swarm-bot/lib/recording-watchdog.ts): бот замолчал посреди встречи.
 * Язык человека сервер не знает — отправляются оба, английский первым.
 */
export const BOT_SILENT_ALERT: Record<NoticeLang, string> = {
  en: "⚠️ <b>{title}</b>: {bot} stopped responding in the middle of the meeting — it was recording " +
    "and then went silent, most likely its container crashed. The recording may be incomplete " +
    "or missing; check the meeting in Swarm.",
  ru: "⚠️ «<b>{title}</b>»: {bot} перестал отвечать посреди встречи — он вёл запись и замолчал, " +
    "скорее всего упал его контейнер. Запись может быть неполной или не дойти вовсе; проверьте " +
    "встречу в Swarm.",
};

/** Чем заменить название встречи, когда его нет. */
export const NO_TITLE: Record<NoticeLang, string> = {
  en: "untitled meeting",
  ru: "встреча без названия",
};

/** Подпись к технической причине, которая приписывается отдельной строкой. */
export const DETAIL_LABEL: Record<NoticeLang, string> = {
  en: "Details:",
  ru: "Подробности:",
};
