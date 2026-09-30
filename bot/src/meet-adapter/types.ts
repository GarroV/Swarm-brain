/**
 * Контракт адаптера площадки и снимок страницы, на котором работают чистые функции.
 *
 * Весь остальной код бота знает ТОЛЬКО `PlatformAdapter` — ни один селектор, ни одна
 * особенность вёрстки наружу не выходит (принцип 5 конституции: хрупкое живёт за одной
 * границей). `MeetSnapshot` — единственная форма, в которой знание о странице покидает
 * браузер: скрапер собирает его в контексте страницы, разбор и вердикты живут в чистых
 * функциях рядом и проверены тестами.
 */

/**
 * `denied` — отказал живой хост; `blocked` — Meet не пустил гостя до лобби, хост заявки не
 * видел; `unavailable` — страница говорит, что встречи нет или она кончилась. Путать их
 * нельзя: человеку уходят разные уведомления и разные советы (T173).
 * `signin_required` — бот идёт под своим аккаунтом Google, а Google вместо встречи просит
 * войти или подтвердить вход (T175): до двери он не дошёл, чинит это человек, а не хост.
 * `guest_access_closed` — Контур.Толк: комната закрыта для гостей и не открылась за окно ожидания
 * (D040); тот же экран Толк показывает и на несуществующую комнату.
 * `mic_live` — бот оказался в звонке с включённым микрофоном или камерой и вышел: он обязан
 * входить немым (Толк, 30.09.2026 — живой микрофон контейнера пищит в звонок).
 */
export type AdmissionOutcome =
  | "admitted"
  | "denied"
  | "blocked"
  | "unavailable"
  | "signin_required"
  | "guest_access_closed"
  | "mic_live"
  | "timeout"
  | "captcha";

export interface PlatformAdapter {
  join(url: string, displayName: string): Promise<void>;
  waitAdmitted(timeoutMs: number): Promise<AdmissionOutcome>;
  activeSpeaker(): Promise<string | null>;
  isAlone(): Promise<boolean>;
  leave(): Promise<void>;
}

/**
Плитка участника: `[data-participant-id]` в вёрстке Meet.
*/
export interface MeetTile {
  readonly id: string;
  /**
  Имя из плитки; `null` — плитка есть, имя не прочиталось.
  */
  readonly name: string | null;
  /**
  Наша собственная плитка (маркер `[data-self-name]`).
  */
  readonly self: boolean;
  /**
   * Уровень звука из семантического атрибута `data-audio-level`. `null` значит
   * «атрибута на странице нет» — это НЕ тишина, а отсутствие сигнала, и путать их нельзя.
   */
  readonly audioLevel: number | null;
}

export interface MeetSnapshot {
  /**
  Видимый текст страницы: нормализованный (нижний регистр, прямые апострофы) и урезанный.
  */
  readonly text: string;
  /**
  Поле ввода имени — признак лобби гостя.
  */
  readonly hasNameInput: boolean;
  /**
  Кнопка входа («Ask to join» / «Join now»).
  */
  readonly hasJoinCta: boolean;
  /**
  Маркер собственной плитки `[data-self-name]`: в лобби его нет.
  */
  readonly hasSelfTile: boolean;
  /**
  Кнопка показа экрана — есть только внутри звонка.
  */
  readonly hasPresentControl: boolean;
  /**
   * ЖИВАЯ капча: видимый iframe reCAPTCHA размером с задачу. Невидимый фрейм грузится на
   * каждом обычном входе, поэтому сам факт фрейма капчей не является (грабля из Vexa).
   */
  readonly captchaChallenge: boolean;
  /**
  Хост открытой страницы: Google уводит на `accounts.google.com`, когда вход слетел.
  */
  readonly host: string;
  /**
   * Видимое приглашение войти (ссылка на страницу входа Google или кнопка «Sign in»). Под
   * сохранённым входом его быть не должно: есть — значит сессия умерла молча.
   */
  readonly hasSignInPrompt: boolean;
  readonly tiles: readonly MeetTile[];
  /**
  Число строк в панели участников, если панель открыта.
  */
  readonly panelParticipantCount: number | null;
}
