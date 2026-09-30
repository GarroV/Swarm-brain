/**
 * Задача в фоне, у которой сбой не теряется: либо отработала, либо её ошибка ушла в журнал.
 * Голый `void promise` здесь запрещён именно потому, что молча глотает отказ.
 */
export function inBackground(
  task: () => Promise<unknown>,
  onError: (error: unknown) => void,
): void {
  void (async (): Promise<void> => {
    try {
      await task();
    } catch (error) {
      onError(error);
    }
  })();
}
