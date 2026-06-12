import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Имя для показа: если бэкенд не зарезолвил имя и оставил сырой telegram_id (только цифры),
// показываем «#id» вместо голого числа. Иначе — имя как есть.
export function displayName(raw: string | null | undefined): string {
  if (!raw) return "—";
  return /^\d+$/.test(raw.trim()) ? `#${raw.trim()}` : raw;
}
