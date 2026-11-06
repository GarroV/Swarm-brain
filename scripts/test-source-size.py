#!/usr/bin/env python3
"""Exercise the actual gate against isolated Git repositories and staged blobs."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import sys

GATE = Path(os.environ.get("SIZE_GATE_UNDER_TEST", Path(__file__).with_name("check-source-size.py"))).resolve()
REGISTRY = "scripts/source-size-debt.json"
HOOK = Path(__file__).resolve().parent.parent / ".githooks/pre-commit"


class SourceSizeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="swarm-size-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "user.name", "Fixture")
        self.git("commit", "-qm", "empty", "--allow-empty")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, stderr=subprocess.STDOUT)

    def source(self, count, name="source.py"):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("# source\n" * count)

    def debt(self, values):
        target = self.root / REGISTRY
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(values))

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")

    def legacy(self, count=805):
        self.source(count)
        self.debt({"source.py": count})
        self.commit()

    def check(self, status, *args):
        result = subprocess.run(["python3", str(GATE), *args], cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, status, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def staged(self, status):
        self.git("add", ".")
        return self.check(status, "--staged")

    def test_new_800_allowed(self):
        self.source(800)
        self.staged(0)

    def test_new_801_rejected(self):
        self.source(801)
        self.assertIn("new monolith", self.staged(1))

    def test_web_styles_powershell_and_workflows_are_source(self):
        for extension in (".css", ".html", ".ps1", ".psm1", ".scss", ".yml", ".yaml", ".PY", ".TS"):
            with self.subTest(extension=extension):
                name = "large" + extension
                self.source(801, name)
                self.assertIn("new monolith", self.staged(1))
                (self.root / name).unlink()
                self.git("add", "-A")

    def test_makefiles_and_containerfiles_are_source(self):
        for name in ("Makefile", "makefile", "GNUmakefile", "Dockerfile", "Containerfile", "Dockerfile.test", "rules.mk"):
            with self.subTest(name=name):
                self.source(801, name)
                self.assertIn("new monolith", self.staged(1))
                (self.root / name).unlink()
                self.git("add", "-A")

    def test_cr_lines_count_and_crlf_is_not_double_counted(self):
        source = self.root / "source.py"
        source.write_bytes(b"x = 1\r" * 801)
        compile(source.read_bytes(), str(source), "exec")
        self.assertIn("new monolith", self.staged(1))
        source.write_bytes(b"x = 1\r\n" * 800)
        self.staged(0)

    def test_unchanged_debt_allowed(self):
        self.legacy()
        self.staged(0)

    def test_growth_cannot_be_hidden_by_raising_registry(self):
        self.legacy()
        self.source(806)
        self.debt({"source.py": 806})
        self.assertIn("grew", self.staged(1))

    def test_shrink_ratchets_registry(self):
        self.legacy()
        self.source(803)
        self.debt({"source.py": 803})
        self.staged(0)

    def test_stale_registry_after_shrink_rejected(self):
        self.legacy()
        self.source(803)
        self.assertIn("exactly 803", self.staged(1))

    def test_resolved_debt_must_leave_registry(self):
        self.legacy()
        self.source(800)
        self.assertIn("remove resolved", self.staged(1))
        self.debt({})
        self.staged(0)

    def test_new_debt_cannot_be_added_to_bypass_limit(self):
        self.source(801)
        self.debt({"source.py": 801})
        self.assertIn("new monolith", self.staged(1))

    def test_unstaged_small_file_cannot_hide_large_staged_file(self):
        self.source(801)
        self.git("add", ".")
        self.source(10)
        self.assertIn("new monolith", self.check(1, "--staged"))

    def test_ci_compares_entire_branch_not_last_commit(self):
        self.legacy()
        base = self.git("rev-parse", "HEAD").decode().strip()
        self.source(806)
        self.debt({"source.py": 806})
        self.commit()
        self.source(1, "later.py")
        self.commit()
        self.assertIn("grew", self.check(1, "--base", base))

    def test_initial_registry_can_only_capture_existing_monoliths(self):
        self.source(805)
        self.commit()
        self.debt({"source.py": 805})
        self.staged(0)

    def test_missing_base_fails_closed(self):
        self.check(2, "--base", "missing-ref")

    def test_invalid_registry_fails_closed(self):
        self.debt({"source.py": True})
        self.staged(2)

    def test_extensionless_script_is_checked(self):
        (self.root / "script").write_text("#!/bin/sh\n" + "true\n" * 800)
        self.assertIn("new monolith", self.staged(1))

    def test_deleted_monolith_with_removed_debt_allowed(self):
        self.legacy()
        (self.root / "source.py").unlink()
        self.debt({})
        self.staged(0)

    def test_real_precommit_hook_rejects_large_source_and_accepts_limit(self):
        scripts = self.root / "scripts"
        scripts.mkdir()
        (scripts / "check-source-size.py").write_bytes(GATE.read_bytes())
        self.source(801)
        self.git("add", ".")
        result = subprocess.run(["bash", str(HOOK)], cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("new monolith", result.stderr)
        self.source(800)
        self.git("add", ".")
        result = subprocess.run(["bash", str(HOOK)], cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_last_line_without_newline_counts(self):
        self.source(800)
        target = self.root / "source.py"
        target.write_text(target.read_text() + "# final line")
        self.assertIn("new monolith", self.staged(1))


def porcha():
    original = GATE.read_text()
    mutations = [
        ("if previous <= LIMIT:", "if False:", "test_new_debt_cannot_be_added_to_bypass_limit"),
        ("elif count > min(previous, old_debt.get(path, previous)):", "elif False:",
         "test_growth_cannot_be_hidden_by_raising_registry"),
    ]
    for old, new, expected in mutations:
        assert original.count(old) == 1
        with tempfile.TemporaryDirectory(prefix="swarm-size-mutant-") as directory:
            mutant = Path(directory) / "gate.py"
            mutant.write_text(original.replace(old, new))
            result = subprocess.run(
                [sys.executable, str(Path(__file__).resolve())], capture_output=True, text=True,
                env={**os.environ, "SIZE_GATE_UNDER_TEST": str(mutant)},
            )
            assert result.returncode != 0 and f"FAIL: {expected}" in result.stderr, result.stderr
            print(f"porcha: caught {expected}")


if __name__ == "__main__":
    if sys.argv[1:] == ["porcha"]:
        porcha()
    else:
        unittest.main()
