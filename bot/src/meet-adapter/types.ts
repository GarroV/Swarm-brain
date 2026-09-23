/**
 * Контракт адаптера площадки и снимок страницы, на котором работают чистые функции.
 *
 * Весь остальной код бота знает ТОЛЬКО `PlatformAdapter` — ни один селектор, ни одна
 * особенность вёрстки наружу не выходит (принцип 5 конституции: хрупкое живёт за одной
 * границей). `MeetSnapshot` — единственная форма, в которой знание о странице покидает
 * браузер: скрапер собирает его в контексте страницы, разбор и вердикты живут в чистых
 * функциях рядом и проверены тестами.
 */

export type AdmissionOutcome = "admitted" | "denied" | "timeout" | "captcha";

export interface PlatformAdapter {
  join(url: string, displayName: string): Promise<void>;
  waitAdmitted(timeoutMs: number): Promise<AdmissionOutcome>;
  activeSpeaker(): Promise<string | null>;
  isAlone(): Promise<boolean>;
  leave(): Promise<void>;
}

/** Плитка участника: `[data-participant-id]` в вёрстке Meet. */
export interface MeetTile {
  readonly id: string;
  /** Имя из плитки; `null` — плитка есть, имя не прочиталось. */
  readonly name: string | null;
  /** Наша собственная плитка (маркер `[data-self-name]`). */
  readonly self: boolean;
  /**
   * Уровень звука из семантического атрибута `data-audio-level`. `null` значит
   * «атрибута на странице нет» — это НЕ тишина, а отсутствие сигнала, и путать их нельзя.
   */
  readonly audioLevel: number | null;
}

export interface MeetSnapshot {
  /** Видимый текст страницы: нормализованный (нижний регистр, прямые апострофы) и урезанный. */
  readonly text: string;
  /** Поле ввода имени — признак лобби гостя. */
  readonly hasNameInput: boolean;
  /** Кнопка входа («Ask to join» / «Join now»). */
  readonly hasJoinCta: boolean;
  /** Маркер собственной плитки `[data-self-name]`: в лобби его нет. */
  readonly hasSelfTile: boolean;
  /** Кнопка показа экрана — есть только внутри звонка. */
  readonly hasPresentControl: boolean;
  /**
   * ЖИВАЯ капча: видимый iframe reCAPTCHA размером с задачу. Невидимый фрейм грузится на
   * каждом обычном входе, поэтому сам факт фрейма капчей не является (грабля из Vexa).
   */
  readonly captchaChallenge: boolean;
  readonly tiles: readonly MeetTile[];
  /** Число строк в панели участников, если панель открыта. */
  readonly panelParticipantCount: number | null;
}
