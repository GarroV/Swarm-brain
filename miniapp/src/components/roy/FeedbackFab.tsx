"use client";
import { useState } from "react";
import { RoyIcon } from "@/components/roy/icons";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FeedbackForm } from "./FeedbackForm";

/** Плавающая кнопка «?» в углу — открывает форму фидбека из любого экрана. */
export function FeedbackFab() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Оставить фидбек"
        title="Оставить фидбек"
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-[0_8px_24px_rgba(0,0,0,.28)] transition-transform hover:scale-105 active:scale-95 lg:bottom-6 lg:right-6"
      >
        <RoyIcon name="help" size={22} strokeWidth={2} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Фидбек</DialogTitle>
          </DialogHeader>
          <FeedbackForm onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
