"use client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FeedbackForm } from "./FeedbackForm";

/** Диалог фидбека без своей кнопки — для пунктов меню («Ещё» на мобайле). */
export function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Фидбек</DialogTitle>
        </DialogHeader>
        <FeedbackForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

// Плавающей кнопки больше нет: на мобайле фидбек — пункт «Ещё» (аудит 2026-08-22), на десктопе —
// пункт низа рейки (RoyRail → FeedbackItem, 25.09.2026: кнопка в углу закрывала кнопки строк).
