"use client";
import { useEffect } from "react";
import { initApp } from "@/lib/telegram";

export function TelegramProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    initApp();
  }, []);
  return <>{children}</>;
}
