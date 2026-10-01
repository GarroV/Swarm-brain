/**
 * Снимок страницы Контур.Толка — единственная форма, в которой знание о вёрстке покидает браузер.
 *
 * Скрапер (`dom.ts`) собирает его в контексте страницы; что увиденное значит — решают чистые
 * функции `page.ts` и `speakers.ts`, проверенные тестами. Контракт адаптера — общий с Meet
 * (`PlatformAdapter` в `meet-adapter/types.ts`): остальной код бота площадок не различает.
 */

/**
Плитка участника в звонке: элемент `conference-participant`.
*/
export interface KonturTile {
  /**
  Имя из `.participant-info-content`; `null` — плитка есть, имя не прочиталось.
  */
  readonly name: string | null;
  /**
  Толк подсвечивает говорящего классом `active-speaker` на плитке.
  */
  readonly speaking: boolean;
}

export interface KonturSnapshot {
  /**
  Заголовок вкладки: «Подключение к встрече — Толк» до входа, «Встреча — Толк» в звонке.
  */
  readonly title: string;
  /**
  Видимый текст страницы, урезанный; нормализует его `page.ts`.
  */
  readonly text: string;
  /**
  Поле «Представьтесь»: форма имени гостя.
  */
  readonly hasNameInput: boolean;
  /**
  Кнопка «Продолжить» формы имени.
  */
  readonly hasContinueButton: boolean;
  /**
  Кнопка «Присоединиться» экрана устройств.
  */
  readonly hasJoinButton: boolean;
  /**
   * Видна кнопка «Выключить микрофон» — значит, микрофон бота ВКЛЮЧЁН. Бот обязан входить немым:
   * живой микрофон в контейнере пищит в звонок (владелец это слышал).
   */
  readonly hasMicOnControl: boolean;
  /**
  Видна кнопка «Выключить камеру» — камера бота включена.
  */
  readonly hasCameraOnControl: boolean;
  /**
  Область плиток звонка `conference-participants-area` — есть только внутри звонка.
  */
  readonly hasParticipantsArea: boolean;
  readonly tiles: readonly KonturTile[];
  /**
   * Число с кнопки «Участники» (Толк пишет его текстом на кнопке). `null` — кнопки нет или
   * числа на ней не прочиталось.
   */
  readonly participantCount: number | null;
}
