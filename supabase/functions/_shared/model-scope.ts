// Замок модели на запрос: демо-сессия НИКОГДА не доходит до OpenAI (решение владельца 27.10.2026,
// docs/decisions/2026-10-27-demo-no-model.md). Ссылка на демо публична, каждый вызов модели —
// деньги, и лимит «N запросов в день» заменён запретом целиком.
//
// Два слоя. Верхний — маршрутный (swarm-api/demo-questions.ts): демо получает заготовленные
// ответы или отказ, до любой модели дело не доходит. Этот — нижний, страховка на случай маршрута,
// про который забыли: `externalFetch` перед любым вызовом сервиса «openai» спрашивает замок и
// бросает ошибку. Замок хранится в контексте запроса (AsyncLocalStorage), поэтому его не надо
// протаскивать через десяток слоёв, и он не протекает в соседние запросы.
import { AsyncLocalStorage } from "node:async_hooks";

type ModelScope = { blocked: boolean };

const storage = new AsyncLocalStorage<ModelScope>();

/** Вызов модели запрещён в этом запросе (демо-сессия). */
export class ModelBlockedError extends Error {
  constructor(readonly target: string) {
    super(`model call blocked for a demo session (${target})`);
    this.name = "ModelBlockedError";
  }
}

/** Оборачивает обработку одного запроса: у каждого запроса свой замок, по умолчанию открытый. */
export function withModelScope<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ blocked: false }, fn);
}

/**
 * Закрывает модель для текущего запроса. Вне `withModelScope` — ошибка, а не тихий пропуск:
 * замок, который не встал, не должен выглядеть поставленным.
 */
export function blockModelCalls(): void {
  const scope = storage.getStore();
  if (!scope) throw new Error("blockModelCalls вне withModelScope: замок не встанет");
  scope.blocked = true;
}

/** Зовёт `externalFetch` перед обращением к OpenAI. */
export function assertModelAllowed(target: string): void {
  if (storage.getStore()?.blocked) throw new ModelBlockedError(target);
}
