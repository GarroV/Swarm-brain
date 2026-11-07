#!/usr/bin/env python3
"""Offline fixtures: no Docker, SSH, environment files or production reads."""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


TOOL = Path(__file__).with_name("prepare-swarm-memory-limits.py").resolve()
spec = importlib.util.spec_from_file_location("swarm_memory", TOOL)
memory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(memory)
EXPECTED = {
    "db": "2g", "functions": "2g", "storage": "512m", "imgproxy": "512m",
    "auth": "256m", "rest": "256m", "api-gw": "256m",
}


def fixture():
    text = "# Synthetic only; preserve this comment\nname: fixture\nservices:\n"
    for service in ["api-gw", "supavisor", "functions", "studio", "meta", "realtime",
                    "db", "auth", "rest", "storage", "imgproxy"]:
        text += f"  {service}:\n    restart: unless-stopped\n"
        if service == "api-gw":
            text += "    ports: !reset []\n    environment: !override\n"
            text += '      SYNTHETIC_VALUE: "${PRESERVE_ME}" # opaque\n'
        if service == "db":
            text += '    command: ["opaque", "value: with # punctuation"]\n'
    return (text + "networks:\n  edge-swarm:\n    external: true\n").encode()


def compliant():
    data = fixture()
    for service, value in EXPECTED.items():
        header = f"  {service}:\n".encode()
        data = data.replace(header, header + f"    mem_limit: {value}\n    memswap_limit: {value}\n".encode())
    return data


class MemoryPreparationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="swarm-memory-fixture-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / "source.yml"
        self.target = self.root / "candidate.yml"
        self.rejection = 0
        self.source.write_bytes(fixture())

    def cli(self, code, *args):
        result = subprocess.run([sys.executable, str(TOOL), *map(str, args)],
                                capture_output=True, text=True, cwd=self.root)
        self.assertEqual(result.returncode, code, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        parsed = json.loads(result.stdout)
        self.assertEqual(set(parsed), {"status", "changes", "error_type"})
        self.assertNotIn("PRESERVE_ME", result.stdout)
        self.assertNotIn(str(self.source), result.stdout)
        for item in parsed["changes"]:
            self.assertIn(item["service"], EXPECTED)
            self.assertIn(item["field"], ["mem_limit", "memswap_limit"])
            self.assertIsInstance(item["expected_bytes"], int)
        return parsed

    def reject(self, data, error_type):
        self.rejection += 1
        self.target = self.root / f"rejected-{self.rejection}.yml"
        self.source.write_bytes(data)
        result = self.cli(2, "prepare", self.source, self.target)
        self.assertEqual(result["error_type"], error_type)
        self.assertFalse(self.target.exists())
        self.assertEqual(self.source.read_bytes(), data)

    def test_default_check_is_read_only_and_reports_exact_fourteen_fields(self):
        before = self.source.stat()
        result = self.cli(1, self.source)
        self.assertEqual(result["status"], "needs_changes")
        self.assertEqual(len(result["changes"]), 14)
        self.assertEqual({x["service"] for x in result["changes"]}, set(EXPECTED))
        self.assertEqual(self.source.read_bytes(), fixture())
        self.assertEqual(self.source.stat().st_mtime_ns, before.st_mtime_ns)
        self.assertFalse(self.target.exists())

    def test_prepare_candidate_is_green_and_input_unchanged(self):
        self.assertEqual(self.cli(0, "prepare", self.source, self.target)["status"], "prepared")
        self.assertEqual(self.source.read_bytes(), fixture())
        self.assertEqual(self.target.read_bytes(), compliant())
        self.assertEqual(self.cli(0, "check", self.target)["status"], "ok")
        stripped = re.sub(rb"^    mem(?:swap)?_limit: [^\n]*\n", b"", self.target.read_bytes(), flags=re.M)
        self.assertEqual(stripped, fixture())

    def test_fixed_policy_matches_owner_values_in_bytes(self):
        self.assertEqual({s: b for s, (_, b) in memory.POLICY.items()}, {
            "db": 2147483648, "functions": 2147483648,
            "storage": 536870912, "imgproxy": 536870912,
            "auth": 268435456, "rest": 268435456, "api-gw": 268435456,
        })

    def test_idempotent_candidate_and_equivalent_values(self):
        source = compliant().replace(b"    mem_limit: 2g\n", b'    mem_limit: "2048m"\n', 1)
        source = source.replace(b"    memswap_limit: 2g\n", b"    memswap_limit: 2147483648\n", 1)
        candidate, changes = memory.analyze(source)
        self.assertEqual(candidate, source)
        self.assertEqual(changes, [])
        self.source.write_bytes(source)
        self.cli(0, "prepare", self.source, self.target)
        self.assertEqual(self.target.read_bytes(), source)

    def test_replacement_preserves_quotes_spacing_comments_and_other_fields(self):
        source = compliant().replace(b"    mem_limit: 2g\n", b"    mem_limit:  '1g'   # keep comment\n", 1)
        source = source.replace(b"    memswap_limit: 2g\n", b"    memswap_limit: -1 # keep swap comment\n", 1)
        candidate, changes = memory.analyze(source)
        expected = source.replace(b"'1g'", b"'2g'").replace(b"-1 # keep swap", b"2g # keep swap")
        self.assertEqual(candidate, expected)
        self.assertEqual(len(changes), 2)
        self.assertEqual(memory.analyze(candidate)[1], [])

    def test_crlf_and_missing_final_newline_preserved(self):
        source = fixture().replace(b"\n", b"\r\n").removesuffix(b"\r\n")
        candidate, _ = memory.analyze(source)
        self.assertEqual(candidate, compliant().replace(b"\n", b"\r\n").removesuffix(b"\r\n"))
        self.assertNotIn(b"\n", candidate.replace(b"\r\n", b""))

    def test_comments_tags_non_target_and_nested_memory_names_preserved(self):
        source = fixture().replace(b"  db:\n", b"  db: # retain header comment\n")
        source = source.replace(b"      SYNTHETIC_VALUE:", b"      mem_limit: not-a-service-cap\n      SYNTHETIC_VALUE:")
        source = source.replace(b"  studio:\n", b"  studio:\n    mem_limit: 9g # unrelated service\n")
        candidate, _ = memory.analyze(source)
        self.assertIn(b"!reset []", candidate)
        self.assertIn(b"!override\n", candidate)
        self.assertIn(b"      mem_limit: not-a-service-cap\n", candidate)
        self.assertIn(b"    mem_limit: 9g # unrelated service\n", candidate)
        self.assertIn(b"  db: # retain header comment\n    mem_limit: 2g\n", candidate)

    def test_existing_candidate_and_same_input_are_never_overwritten(self):
        self.target.write_bytes(b"existing candidate")
        self.assertEqual(self.cli(2, "prepare", self.source, self.target)["error_type"], "candidate_exists")
        self.assertEqual(self.target.read_bytes(), b"existing candidate")
        self.assertEqual(self.cli(2, "prepare", self.source, self.source)["error_type"], "candidate_exists")
        self.assertEqual(self.source.read_bytes(), fixture())

    def test_candidate_symlink_never_overwrites_referent(self):
        self.target.symlink_to(self.source)
        self.assertEqual(self.cli(2, "prepare", self.source, self.target)["error_type"], "candidate_exists")
        self.assertTrue(self.target.is_symlink())
        self.assertEqual(self.source.read_bytes(), fixture())

    def test_candidate_mode_is_0600_even_under_restrictive_umask(self):
        previous = os.umask(0o777)
        try:
            memory.write_candidate(self.target, b"fixture")
        finally:
            os.umask(previous)
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o600)

    def test_write_failure_removes_owned_partial_candidate(self):
        with patch.object(memory.os, "fsync", side_effect=OSError("synthetic")):
            with self.assertRaisesRegex(memory.ConfigError, "^io_write$"):
                memory.write_candidate(self.target, b"fixture")
        self.assertFalse(self.target.exists())

    def test_permission_failure_removes_candidate_and_closes_descriptor(self):
        with patch.object(memory.os, "fchmod", side_effect=OSError("synthetic")):
            with self.assertRaisesRegex(memory.ConfigError, "^io_write$"):
                memory.write_candidate(self.target, b"fixture")
        self.assertFalse(self.target.exists())

    def test_malformed_or_ambiguous_structures_make_no_candidate(self):
        cases = [
            (fixture().replace(b"  db:\n", b""), "duplicate_field"),
            (fixture().replace(b"  db:\n", b"  database:\n"), "missing_service"),
            (fixture().replace(b"  db:\n", b"  db:\n  db:\n"), "duplicate_service"),
            (fixture() + b"services:\n", "duplicate_services_block"),
            (fixture().replace(b"services:\n", b"services: {}\n"), "ambiguous_structure"),
            (fixture().replace(b"services:\n", b"other:\n"), "missing_services_block"),
            (fixture().replace(b"  db:\n", b'  "db":\n'), "ambiguous_structure"),
            (fixture().replace(b"  db:\n", b"  db: &alias\n"), "ambiguous_structure"),
            (fixture().replace(b"  db:\n", b"  db:\n    <<: *alias\n"), "ambiguous_structure"),
            (fixture().replace(b"  db:\n", b'  db:\n    "mem_limit": 2g\n'), "ambiguous_structure"),
            (fixture().replace(b"  db:\n", b"  db:\n   mem_limit: 2g\n"), "ambiguous_structure"),
            (fixture().replace(b"  db:\n", b"  db:\n    mem_limit: 1g\n    mem_limit: 2g\n"), "duplicate_field"),
            (fixture().replace(b"  db:\n", b"  db:\n    command: first\n"), "duplicate_field"),
            (fixture().replace(b"  db:\n", b"  db:\n    mem_limit: ${OPAQUE}\n"), "unsupported_memory_value"),
            (fixture().replace(b"  db:\n", b"  db:\n    mem_limit: " + b"9" * 5000 + b"\n"), "unsupported_memory_value"),
            (fixture() + b"# tab\there\n", "tabs_not_supported"),
            (fixture().replace(b"\n", b"\r\n", 1), "invalid_line_endings"),
            (fixture() + b"\x00", "invalid_encoding"),
            (fixture() + b"\xff", "invalid_encoding"),
        ]
        for source, kind in cases:
            with self.subTest(kind=kind, size=len(source)):
                self.reject(source, kind)

    def test_input_bounds_and_io_errors_are_sanitized(self):
        self.reject(b"x" * (memory.MAX_BYTES + 1), "input_too_large")
        self.reject(fixture() + b"#" * (memory.MAX_LINE_BYTES + 1), "input_too_large")
        self.reject(fixture() + b"\n" * memory.MAX_LINES, "input_too_large")
        result = self.cli(2, self.root / "missing.yml")
        self.assertEqual(result["error_type"], "io_read")
        self.assertEqual(self.cli(2, "prepare")["error_type"], "io_read")
        self.assertEqual(self.cli(2, "check", self.source, "extra")["error_type"], "invalid_arguments")


if __name__ == "__main__":
    unittest.main()
