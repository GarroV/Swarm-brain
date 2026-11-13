export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${
    String(d.getDate()).padStart(2, "0")
  }`;
}

/** Имя по умолчанию — «Спринт 10.09 — 23.09»: так их называют в переписке. */
export function defaultCycleName(from: Date, to: Date): string {
  const dm = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}.${
      String(d.getMonth() + 1).padStart(2, "0")
    }`;
  return `Спринт ${dm(from)} — ${dm(to)}`;
}
