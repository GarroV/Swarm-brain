"use client";
import { useState } from "react";
import { RoyIcon } from "@/components/roy/icons";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FeedbackForm } from "./FeedbackForm";
import { useDt } from "@/components/roy/nav";

/** Диалог фидбека без своей кнопки — для пунктов меню («Ещё» на мобайле). */
export function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const dt = useDt();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{dt("Фидбек", "Feedback")}</DialogTitle>
        </DialogHeader>
        <FeedbackForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Плавающая кнопка-пузырь в углу — открывает форму фидбека из любого экрана.
 *  На мобайле НЕ используется: там она стояла вторым FAB под «+» и спорила с главным
 *  действием экрана — фидбек живёт пунктом в «Ещё» (аудит мобилки 2026-08-22). */
export function FeedbackFab() {
  const [open, setOpen] = useState(false);
  const dt = useDt();
  return (
    <>
      <button
        type="button"
        aria-label={dt("Оставить фидбек", "Send feedback")}
        title={dt("Оставить фидбек", "Send feedback")}
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-[0_8px_24px_rgba(0,0,0,.28)] transition-transform hover:scale-105 active:scale-95 lg:bottom-6 lg:right-6"
      >
        <RoyIcon name="feedback" size={22} strokeWidth={2} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{dt("Фидбек", "Feedback")}</DialogTitle>
          </DialogHeader>
          <FeedbackForm onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
