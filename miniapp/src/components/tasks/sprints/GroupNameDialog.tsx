"use client";
import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Button } from "@/components/ui/button";
import { useDt } from "@/components/roy/nav";

// Окошко названия группы спринта: задачу бросили на задачу — спрашиваем имя (решение владельца
// 01.10.2026: «перетаскиваю задачу на другую задачу и у меня появляется окошко для внесения
// названия этой группировки»). Тем же окном группа переименовывается. Enter — создать, Esc —
// отмена; пустое имя кнопку не нажимает.

export function GroupNameDialog(
  { open, initial, busy, rename, onCancel, onSubmit }: {
    open: boolean;
    initial: string;
    busy: boolean;
    /** Переименование существующей группы — другой заголовок и кнопка. */
    rename?: boolean;
    onCancel: () => void;
    onSubmit: (name: string) => void;
  },
) {
  const dt = useDt();
  const [name, setName] = useState(initial);
  // Каждое открытие — с чистого (или текущего) имени: черновик прошлой группы сюда не попадает.
  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);

  const value = name.trim();
  const submit = () => {
    if (value && !busy) onSubmit(value);
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[100] bg-black/45 supports-backdrop-filter:backdrop-blur-[2px]" />
        <DialogPrimitive.Popup
          aria-labelledby="group-name-title"
          className="fixed top-1/2 left-1/2 z-[100] w-[calc(100%-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-[14px] border border-line bg-[var(--popover)] p-5 text-popover-foreground shadow-[0_28px_70px_-20px_rgba(0,0,0,.55)] outline-none dark:backdrop-blur-xl"
        >
          <DialogPrimitive.Title
            id="group-name-title"
            className="font-heading text-[17px] leading-snug font-bold text-ink"
          >
            {rename
              ? dt("Переименовать группу", "Rename group")
              : dt("Название группы", "Group name")}
          </DialogPrimitive.Title>
          {!rename && (
            <DialogPrimitive.Description className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
              {dt(
                "Обе задачи уйдут в новую группу спринта. На доске «Проекты» её не будет, пока не нажмёте «В проекты».",
                "Both tasks move into a new sprint group. It stays off the Projects board until you press “To projects”.",
              )}
            </DialogPrimitive.Description>
          )}
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            maxLength={120}
            placeholder={dt("Например, Запуск Эстонии", "For example, Estonia launch")}
            aria-label={dt("Название группы", "Group name")}
            className="mt-4 w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-accent-line"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              {dt("Отмена", "Cancel")}
            </Button>
            <Button onClick={submit} disabled={!value || busy}>
              {rename ? dt("Сохранить", "Save") : dt("Создать", "Create")}
            </Button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
