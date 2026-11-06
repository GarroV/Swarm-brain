/**
 * Очередь «по одному»: задачи идут строго друг за другом, сбой одной не останавливает остальные
 * и достаётся только тому, кто её поставил. Нужна там, где два запуска, закончившихся разом,
 * иначе писали бы один и тот же временный файл или слали бы одно сообщение дважды.
 */
export class SerialQueue {
  #tail: Promise<void> = Promise.resolve();

  async run<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    const result = (async (): Promise<T> => {
      await previous;
      return task();
    })();
    this.#tail = (async (): Promise<void> => {
      try {
        await result;
      } catch {
        // Ошибку получает вызывающий через `result`; очередь идёт дальше.
      }
    })();
    return result;
  }
}
