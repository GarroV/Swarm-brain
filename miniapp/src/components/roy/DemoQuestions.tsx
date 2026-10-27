"use client";
import { useEffect, useState } from "react";
import { fetchDemoQuestions, type DemoQuestion } from "@/lib/api";
import { useDt } from "./nav";
import { SectionLabel, Chip } from "./ui";

// Демо без модели (docs/decisions/2026-10-27-demo-no-model.md): вместо свободного вопроса базе —
// набор заготовленных вопросов с заранее подготовленными ответами. Показывается только в демо-сессии
// (вызывающий проверяет useIsDemo()); поле ввода там скрыто, а здесь объяснено, почему.
export function useDemoQuestions(): DemoQuestion[] {
  const [list, setList] = useState<DemoQuestion[]>([]);
  useEffect(() => {
    let alive = true;
    fetchDemoQuestions()
      .then((q) => alive && setList(q))
      .catch((e) => console.warn("[DemoQuestions] list", e));
    return () => { alive = false; };
  }, []);
  return list;
}

export function DemoQuestionChips({ onPick }: { onPick: (question: string) => void }) {
  const dt = useDt();
  const list = useDemoQuestions();
  return (
    <div>
      <SectionLabel>{dt("В демо — примеры вопросов", "In the demo — sample questions")}</SectionLabel>
      <p className="mb-2.5 text-ink-soft" style={{ fontSize: 12.5 }}>
        {dt(
          "Ответы заготовлены заранее по демо-данным: в демо модель ИИ не вызывается.",
          "Answers are prepared in advance from the demo data: the demo never calls the AI model.",
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {list.map((d) => (
          <Chip key={d.id} onClick={() => onPick(d.question)}>{dt(d.question_ru, d.question)}</Chip>
        ))}
      </div>
    </div>
  );
}
