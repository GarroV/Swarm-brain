"use client";
import { useEffect, useState } from "react";
import { DEV_MOCKUP, mockupParams, type MockupFill, type MockupLayout } from "@/lib/devMockup";

// Переключатель стенда-макета главной (только DEV_MODE, lib/devMockup.ts). Виден всегда на стенде —
// без параметров в адресе отмечен вариант «как сейчас, много данных». Ссылки перезагружают страницу:
// моки читают выбор при загрузке.
const LAYOUTS: Array<[MockupLayout, string]> = [
  ["A", "Как сейчас: Рейтинги + Встречи"],
  ["B", "Рейтинги + Пиццерии, Встречи + Задачи"],
  ["C", "Рейтинги + Пиццерии, Страны + Встречи"],
];
const FILLS: Array<[MockupFill, string]> = [["full", "Много данных"], ["normal", "Обычный день"], ["empty", "Пустой день"]];

export function DevMockupBar() {
  const [cur, setCur] = useState<ReturnType<typeof mockupParams>>(null);
  useEffect(() => { setCur(mockupParams()); }, []);
  if (!DEV_MOCKUP) return null;
  const layout = cur?.layout ?? "A";
  const fill = cur?.fill ?? "full";
  const btn = (on: boolean) => `rounded-[8px] border px-2.5 py-1 font-semibold ${on ? "border-primary bg-primary text-primary-foreground" : "border-line-2 bg-surface hover:border-accent-line hover:text-primary"}`;
  return (
    <div className="mx-6 mt-3 flex flex-col gap-2 rounded-[10px] border-2 border-dashed border-accent-line bg-accent-soft px-4 py-3 text-ink" style={{ fontSize: 13 }}>
      <div className="flex flex-wrap items-center gap-2">
        <b className="w-[110px] shrink-0">Расстановка</b>
        {LAYOUTS.map(([k, label]) => <a key={k} href={`?layout=${k}&fill=${fill}`} className={btn(layout === k)}>{label}</a>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <b className="w-[110px] shrink-0">Наполнение</b>
        {FILLS.map(([k, label]) => <a key={k} href={`?layout=${layout}&fill=${k}`} className={btn(fill === k)}>{label}</a>)}
      </div>
    </div>
  );
}
