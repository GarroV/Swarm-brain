#!/usr/bin/env python3
"""Гейт цветов на настоящих файлах во временном дереве: чистое проходит, каждый вид нарушения падает
с понятной причиной (проверка, которая не падает на плохом входе, — не проверка)."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

GATE = Path(__file__).with_name("check-theme-colors.py")


class ThemeColorGate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="swarm-colors-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "miniapp/src/components").mkdir(parents=True)
        self.allow = self.root / "allow.json"
        self.allow.write_text("{}")

    def write(self, name, text):
        p = self.root / "miniapp/src" / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def run_gate(self):
        r = subprocess.run([sys.executable, str(GATE), str(self.root), str(self.allow)], capture_output=True, text=True)
        return r.returncode, r.stdout + r.stderr

    def assert_fails(self, needle):
        code, out = self.run_gate()
        self.assertEqual(code, 1, out)
        self.assertIn(needle, out)
        self.assertIn("жёстко вписанный цвет", out)  # причина названа, не просто «упало»
        return out

    def test_tokens_pass(self):
        self.write("components/A.tsx", 'export const A = () => <div className="bg-surface text-ink" style={{ color: "var(--ink)", background: "color-mix(in srgb, var(--primary) 20%, transparent)" }} />;')
        code, out = self.run_gate()
        self.assertEqual(code, 0, out)

    def test_neutral_shadows_and_issue_refs_pass(self):
        self.write("components/A.tsx", '// цвет #fff в комментарии\nconst s = "shadow-[0_2px_8px_rgba(0,0,0,.2)] bg-black/40 ring-black/5";\nconst t = "Учёт с раскатки #311, issue #1285";\nconst u = "rgb(10 13 17 / 0.5)";')
        code, out = self.run_gate()
        self.assertEqual(code, 0, out)

    def test_hex_fails(self):
        self.write("components/A.tsx", 'export const A = () => <div style={{ color: "#ff0000" }} />;')
        out = self.assert_fails("#ff0000")
        self.assertIn("A.tsx:1", out)

    def test_short_hex_fails(self):
        self.write("components/A.tsx", 'const c = "#fff";')
        self.assert_fails("#fff")

    def test_hex_in_css_fails(self):
        self.write("components/a.css", ".x{color:#1B2028}")
        self.assert_fails("#1B2028")

    def test_tailwind_palette_fails(self):
        self.write("components/A.tsx", 'const c = "text-red-500";')
        self.assert_fails("text-red-500")
        self.write("components/A.tsx", 'const c = "bg-white";')
        self.assert_fails("bg-white")

    def test_non_neutral_rgba_fails(self):
        self.write("components/A.tsx", 'const c = "rgba(31,78,156,0.3)";')
        self.assert_fails("rgba(31,78,156,0.3)")

    def test_named_color_fails(self):
        self.write("components/A.tsx", 'const s = { color: "white" };')
        self.assert_fails("white")

    def test_allowlisted_file_passes_until_cap_exceeded(self):
        self.write("components/B.tsx", 'const c = ["#111111", "#222222"];')
        self.allow.write_text(json.dumps({"miniapp/src/components/B.tsx": {"max": 2, "reason": "данные"}}))
        code, out = self.run_gate()
        self.assertEqual(code, 0, out)
        self.write("components/B.tsx", 'const c = ["#111111", "#222222", "#333333"];')
        code, out = self.run_gate()
        self.assertEqual(code, 1, out)
        self.assertIn("#333333", out)

    def test_stale_cap_fails(self):
        self.write("components/B.tsx", 'const c = ["#111111"];')
        self.allow.write_text(json.dumps({"miniapp/src/components/B.tsx": {"max": 5, "reason": "данные"}}))
        code, out = self.run_gate()
        self.assertEqual(code, 1, out)
        self.assertIn("опусти max", out)

    def test_allow_entry_needs_reason(self):
        self.write("components/B.tsx", 'const c = ["#111111"];')
        self.allow.write_text(json.dumps({"miniapp/src/components/B.tsx": {"max": 1}}))
        code, out = self.run_gate()
        self.assertEqual(code, 1, out)
        self.assertIn("reason", out)

    def test_token_files_and_tests_are_skipped(self):
        self.write("app/globals.css", ":root{--ink:#1B2028}")
        self.write("app/schemes.css", "[data-scheme=x]{--ink:#000000}")
        self.write("lib/a.test.ts", 'const c = "#abcdef";')
        code, out = self.run_gate()
        self.assertEqual(code, 0, out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
