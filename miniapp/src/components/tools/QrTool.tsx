"use client";
import { useState } from "react";
import { useT } from "@/components/roy/nav";
import { QrCard } from "./QrCard";

// Плитка «QR-код»: любой текст или адрес → код. Для короткой ссылки есть кнопка «QR» прямо в её
// строке (ShortLinkRow), здесь — всё остальное: адрес сайта, Wi-Fi, телефон, произвольный текст.

const MAX_LEN = 1000; // ёмкость кода уровня M — около 2300 байт; кириллица вдвое тяжелее латиницы

export function QrTool() {
  const t = useT();
  const [text, setText] = useState("");
  const value = text.trim();

  return (
    <div className="w-full max-w-[720px] p-4">
      <p className="mb-3 text-ink-soft" style={{ fontSize: 13 }}>
        {t("tools.qr.description")}
      </p>
      <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))} rows={2}
        placeholder={t("tools.qr.placeholder")}
        className="mb-3 w-full rounded-[10px] border border-line bg-surface px-3 py-2.5 text-ink outline-none focus:border-ink-soft"
        style={{ fontSize: 14 }} />
      <QrCard value={value} fileName={value.replace(/^https?:\/\//, "")} />
    </div>
  );
}
