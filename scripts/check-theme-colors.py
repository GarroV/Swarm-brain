#!/usr/bin/env python3
"""Гейт «нет жёстко вписанных цветов» в miniapp/src (решение 12.11.2026, цветовые схемы).

Зачем. Цвет, вписанный в компонент, не перекрашивается схемой оформления: на тёмной схеме остаётся
белое пятно, на светлой — тёмный текст на тёмном. Цвета живут в токенах (globals.css, schemes.css) и
берутся оттуда: Tailwind-классами (bg-surface, text-ink…) или var(--токен) в стиле.

Что считается нарушением (после вычеркивания комментариев):
  · hex-цвет (#fff, #1B2028, #1B202880);
  · rgb()/rgba()/hsl()/hsla()/oklch()/hwb() с числами — кроме тёмного нейтрального с альфой, у которого
    все каналы ≤ 40 (тени и затемнение одинаковы в любой схеме);
  · палитровые классы Tailwind (bg-red-500, text-white, ring-black…) — кроме bg|ring|border|shadow-black/NN
    (нейтральное затемнение);
  · именованные цвета в свойствах цвета (color: "white", fill="red").
Исключения — файлами, с причиной и потолком числа находок: scripts/theme-colors-allow.json. Потолок
только вниз: новый цвет в разрешённом файле поднимает счётчик и роняет гейт; убрали цвета — гейт просит
опустить потолок, иначе слабина спрятала бы следующий.

Запуск: python3 scripts/check-theme-colors.py [корень репозитория [файл разрешённых исключений]]
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
SRC = ROOT / "miniapp" / "src"
ALLOW = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else Path(__file__).resolve().with_name("theme-colors-allow.json")
SKIP_FILES = {"globals.css", "schemes.css", "schemes-2.css"}  # сами токены
EXT = (".ts", ".tsx", ".css")

HEX = re.compile(r"(?<![\w&/#-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])")
FUNC = re.compile(r"(?<![A-Za-z])(rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(\s*([^)]*)\)")
TAILWIND = re.compile(
    r"(?<![\w-])(?P<prefix>bg|text|border|ring|fill|stroke|from|to|via|divide|outline|shadow|accent|caret|decoration|placeholder)-"
    r"(?P<color>white|black|(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3})"
    r"(?P<alpha>/\d+)?(?![\w-])"
)
NAMED = re.compile(
    r"""(?:color|background|backgroundColor|fill|stroke|stopColor|borderColor|outlineColor)["']?\s*[:=]\s*["'`]"""
    r"(?:white|black|red|green|blue|gray|grey|yellow|orange|purple|pink|silver|navy|teal|maroon|olive|lime|aqua|fuchsia)[\"'`]"
)
NEUTRAL_MAX = 40


def strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    return "\n".join(re.sub(r"(?<![:\w\"'`])//.*$", "", line) for line in text.split("\n"))


def dark_neutral(args: str) -> bool:
    nums = re.findall(r"-?\d+(?:\.\d+)?%?", args)
    if len(nums) < 3 or any(n.endswith("%") for n in nums[:3]):
        return False
    return all(float(n) <= NEUTRAL_MAX for n in nums[:3])


def findings(text: str):
    out = []
    for i, line in enumerate(strip_comments(text).split("\n"), 1):
        for m in HEX.finditer(line):
            tok = m.group(0)[1:]
            # «#311», «#1285» — ссылка на задачу в строке, а не цвет: цвет из 3–4 цифр без букв a–f не считаем.
            if len(tok) in (3, 4) and tok.isdigit():
                continue
            out.append((i, m.group(0)))
        for m in FUNC.finditer(line):
            if m.group(1) in ("rgb", "rgba") and dark_neutral(m.group(2)):
                continue
            if not re.match(r"\s*[\d.]", m.group(2)):
                continue  # rgb(var(--x) / 50%) и подобное — токен
            out.append((i, m.group(0)))
        for m in TAILWIND.finditer(line):
            if m.group("color") == "black" and m.group("alpha") and m.group("prefix") in ("bg", "ring", "border", "shadow"):
                continue
            out.append((i, m.group(0)))
        for m in NAMED.finditer(line):
            out.append((i, m.group(0)))
    return out


def scan():
    result = {}
    for path in sorted(SRC.rglob("*")):
        if not path.is_file() or not path.name.endswith(EXT) or path.name in SKIP_FILES:
            continue
        if re.search(r"\.test\.tsx?$", path.name):
            continue
        found = findings(path.read_text(encoding="utf-8"))
        if found:
            result[path.relative_to(ROOT).as_posix()] = found
    return result


def main() -> int:
    allow = json.loads(ALLOW.read_text(encoding="utf-8")) if ALLOW.exists() else {}
    bad = []
    for rel, spec in allow.items():
        if not spec.get("reason") or not isinstance(spec.get("max"), int):
            bad.append(f"{rel}: в {ALLOW.name} нужны reason (почему цвет не тема) и max (число находок)")
        if not (ROOT / rel).exists():
            bad.append(f"{rel}: файл из {ALLOW.name} не существует — убери запись")
    found = scan()
    for rel, items in found.items():
        spec = allow.get(rel)
        if spec is None:
            for line, tok in items:
                bad.append(
                    f"{rel}:{line}: жёстко вписанный цвет {tok!r} — схема оформления его не перекрасит. "
                    "Возьми токен (Tailwind-класс вроде bg-surface/text-ink или var(--ink), список — "
                    f"miniapp/src/app/globals.css) либо, если цвет — данные, а не тема, внеси файл в scripts/{ALLOW.name} с причиной."
                )
        elif len(items) > spec["max"]:
            bad.append(
                f"{rel}: цветов {len(items)}, разрешено {spec['max']} ({spec['reason']}). "
                f"Новые: " + ", ".join(f"{t!r} (строка {n})" for n, t in items[spec["max"]:][:6])
            )
        elif len(items) < spec["max"]:
            bad.append(f"{rel}: цветов {len(items)}, а потолок {spec['max']} — опусти max в scripts/{ALLOW.name} до {len(items)}")
    for rel, spec in allow.items():
        if rel not in found and (ROOT / rel).exists():
            bad.append(f"{rel}: цветов не осталось — убери запись из scripts/{ALLOW.name}")
    if bad:
        print("✘ жёстко вписанные цвета в miniapp/src:")
        for b in bad:
            print("  " + b)
        return 1
    total = sum(len(v) for v in found.values())
    print(f"✔ цвета: вне токенов только разрешённое ({len(found)} файлов, {total} находок, все в {ALLOW.name})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
