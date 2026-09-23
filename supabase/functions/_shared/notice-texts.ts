// Каталог текстов блока notices: по паре en/ru на каждый отказ.
//
// Правило проекта: новый пользовательский текст заводится сразу на английском и на русском,
// английский приоритетный. Пустая строка здесь = пустое сообщение в Telegram, то есть ровно
// тот молчаливый отказ, против которого блок и заведён; полноту держит структурный тест
// в notices.test.ts.
//
// Подстановка в шаблоне одна — {title} (название встречи). Техническая причина (`detail`)
// добавляется отдельной строкой в renderNotice, в шаблон её вписывать не нужно.
// Разметка — HTML (parse_mode: "HTML"): допустимы <b>, <i>, <code>.
import type { NoticeKind, NoticeLang } from "./notices.ts";

/** Ключ текста. Отличается от kind только у двери: у неё первое сообщение и последнее — разные. */
export type NoticeTextKey = NoticeKind | "door_waiting_last";

export const NOTICE_TEXTS: Record<NoticeTextKey, Record<NoticeLang, string>> = {
  // Бот стоит у двери 90 секунд, его не впустили. Просит впустить, называет встречу,
  // предупреждает, что напомнит ещё один раз и уйдёт.
  door_waiting: {
    en:
      "<b>{title}</b>: scriba has been waiting at the door for 90 seconds and nobody has let it in yet. Please admit it now — if it's still stuck, scriba will remind you once more and then leave without recording.",
    ru:
      "«<b>{title}</b>»: scriba уже 90 секунд стоит у двери, и его до сих пор не впустили. Впустите бота сейчас — если это не поможет, он напомнит ещё раз и после этого уйдёт без записи.",
  },
  // Тот самый единственный повтор, через 3 минуты. Обязан сказать: это последнее напоминание,
  // бот уходит, встреча записана НЕ будет — если запись нужна, записывайте сами.
  door_waiting_last: {
    en:
      "<b>{title}</b>: this is scriba's last reminder — it still hasn't been let in and is leaving now. The meeting will not be recorded; if you need a recording, please make one yourself.",
    ru:
      "«<b>{title}</b>»: это последнее напоминание от scriba — его так и не впустили, и бот уходит прямо сейчас. Запись вестись не будет; если она нужна, запишите встречу сами.",
  },
  // Хост отклонил вход. Ждать нечего, запись не идёт.
  door_denied: {
    en:
      "<b>{title}</b>: the host declined scriba's request to join. There's nothing to wait for — the meeting will not be recorded.",
    ru: "«<b>{title}</b>»: организатор отклонил заявку scriba на вход. Ждать нечего — запись вестись не будет.",
  },
  // На входе капча. Бот её не проходит по устройству, ждать бесполезно.
  captcha: {
    en:
      "<b>{title}</b>: scriba hit a captcha at the door and can't solve it as a device. Waiting won't help — the meeting will not be recorded.",
    ru:
      "«<b>{title}</b>»: на входе scriba наткнулся на капчу и не может пройти её как устройство. Ждать бесполезно — запись вестись не будет.",
  },
  // В приглашении нет распознаваемой ссылки на звонок — бот не пошёл никуда.
  // Человеку стоит подсказать: добавить ссылку в приглашение.
  no_conference_link: {
    en:
      "<b>{title}</b>: scriba found no recognizable call link in the invite, so it didn't join anything. Add a direct link to the invite and it will find the meeting next time.",
    ru:
      "«<b>{title}</b>»: в приглашении не нашлось распознаваемой ссылки на звонок, и scriba никуда не заходил. Добавьте в приглашение прямую ссылку — в следующий раз бот найдёт встречу.",
  },
  // Не удалось определить владельца встречи. Бот НЕ заходит намеренно: запись без владельца
  // не попадёт ни в чью очередь вычитки (принцип приватности).
  no_owner: {
    en:
      "<b>{title}</b>: scriba couldn't determine who owns this meeting and deliberately skipped it. A recording with no owner would never reach anyone's review queue, so none is made.",
    ru:
      "«<b>{title}</b>»: scriba не смог определить владельца встречи и намеренно не стал заходить. Запись без владельца всё равно не попала бы ни в чью очередь вычитки, поэтому её просто не делают.",
  },
  // Бот в звонке, но звука нет: запись не начата. Лучше сказать о тишине, чем записать тишину.
  no_audio: {
    en:
      "<b>{title}</b>: scriba joined but heard no audio at all, so it never started recording. Better to say so than hand you a recording full of silence.",
    ru:
      "«<b>{title}</b>»: scriba зашёл на встречу, но не услышал никакого звука, и запись не начал. Лучше сказать об этом честно, чем прислать вам тишину вместо записи.",
  },
  // Запись сделана, но не доехала в Swarm (сеть, токен). Сама она в очередь вычитки не придёт.
  recording_lost: {
    en:
      "<b>{title}</b>: scriba recorded this meeting, but the recording never reached Swarm — likely a network or token issue. It won't appear in the review queue on its own.",
    ru:
      "«<b>{title}</b>»: scriba записал встречу, но запись не доехала до Swarm — похоже на проблему с сетью или токеном. Сама по себе она в очередь вычитки не попадёт.",
  },
  // Контейнер бота умер посреди встречи: записанное до этого момента может быть неполным.
  container_died: {
    en:
      "<b>{title}</b>: scriba's container crashed partway through the meeting. Whatever was recorded up to that point survived, but the recording may be incomplete.",
    ru:
      "«<b>{title}</b>»: контейнер scriba упал прямо посреди встречи. То, что успело записаться до этого момента, сохранилось, но запись может быть неполной.",
  },
  // Не смог зайти по иной причине. Причина придёт отдельной строкой (detail обязателен).
  join_failed: {
    en:
      "<b>{title}</b>: scriba could not join for a reason that doesn't fit the usual cases, so no recording was made. See the details below.",
    ru:
      "«<b>{title}</b>»: scriba не смог зайти по причине, не подпадающей под обычные случаи, поэтому запись не велась. Подробности ниже.",
  },
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
