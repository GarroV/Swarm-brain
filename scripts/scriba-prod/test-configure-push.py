#!/usr/bin/env python3
"""Pure configuration checks; no Docker, database or production access."""
import importlib.util
import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("configure_push", Path(__file__).with_name("configure-push.py"))
configure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure)


class PushConfigurationTests(unittest.TestCase):
    def test_updates_only_requested_fields_preserving_other_credentials(self):
        source = "# existing configuration\nOTHER_TOKEN=fixture-value\nSCRIBA_SIGNAL_URL=old\n"
        updated = configure.with_values(source, {"SCRIBA_SIGNAL_URL": configure.SIGNAL_URL, "EXTRA": "new"})
        self.assertEqual(updated, "# existing configuration\nOTHER_TOKEN=fixture-value\n"
                         "SCRIBA_SIGNAL_URL=http://scriba-signals:8091/signal\nEXTRA=new\n")

    def test_ambiguous_duplicate_key_refuses(self):
        with self.assertRaises(ValueError):
            configure.with_values("KEY=one\nKEY=two\n", {"KEY": "new"})

    def test_short_or_multiline_secret_refuses(self):
        for value in ["", "abc", "a" * 64 + "\nOTHER_KEY=bad", "A" * 64]:
            with self.assertRaises(ValueError):
                configure.validate_secret(value)
        self.assertEqual(configure.validate_secret("a" * 64), "a" * 64)

    def test_apply_keeps_one_secret_out_of_output_and_process_arguments(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            functions = root / "functions.env"
            prod = root / "prod.env"
            for file in [functions, prod]:
                file.write_text("EXISTING=preserved\n")
                file.chmod(0o600)
            calls = []
            def fake_command(args, data=None):
                calls.append((args, data))
                return "{}" if data and data.startswith("SELECT") else ""
            output = io.StringIO()
            with patch.object(configure, "command", fake_command), patch.object(configure.sys, "argv", [
                "configure-push.py", "--apply", "--secret-stdin", "--state", str(root),
                "--functions-env", str(functions),
            ]), patch.object(configure.sys, "stdin", io.StringIO("a" * 64)), contextlib.redirect_stdout(output):
                self.assertEqual(configure.main(), 0)
            for file in [functions, prod]:
                self.assertIn("EXISTING=preserved\n", file.read_text())
                self.assertIn("SCRIBA_SIGNAL_SECRET=" + "a" * 64, file.read_text())
            self.assertIn("GOOGLE_CALENDAR_PUSH_URL=" + configure.CALENDAR_PUSH_URL, functions.read_text())
            self.assertEqual((root / "signal.secret").read_text().strip(), "a" * 64)
            self.assertNotIn("a" * 64, output.getvalue())
            self.assertTrue(all("a" * 64 not in " ".join(args) for args, _ in calls))
            self.assertFalse(any("restart" in args or "up" in args for args, _ in calls))

    def test_apply_refuses_existing_vault_secret_mismatch_before_writing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            functions = root / "functions.env"
            functions.write_text("EXISTING=preserved\n")
            functions.chmod(0o600)
            calls = []
            def fake_command(args, data=None):
                calls.append(data)
                return '{"scriba_signal_secret":"' + "b" * 64 + '"}' if data else ""
            with patch.object(configure, "command", fake_command), patch.object(configure.sys, "argv", [
                "configure-push.py", "--apply", "--secret-stdin", "--state", str(root),
                "--functions-env", str(functions),
            ]), patch.object(configure.sys, "stdin", io.StringIO("a" * 64)), self.assertRaises(ValueError):
                configure.main()
            self.assertEqual(functions.read_text(), "EXISTING=preserved\n")
            self.assertFalse((root / "signal.secret").exists())
            self.assertFalse(any(data and data.startswith("BEGIN") for data in calls))

    def test_existing_different_public_calendar_url_refuses_without_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            functions = root / "functions.env"
            original = "GOOGLE_CALENDAR_PUSH_URL=https://different.example/notifications\n"
            functions.write_text(original)
            functions.chmod(0o600)
            with patch.object(configure, "command") as command, patch.object(configure.sys, "argv", [
                "configure-push.py", "--apply", "--state", str(root), "--functions-env", str(functions),
            ]), self.assertRaises(ValueError):
                configure.main()
            command.assert_not_called()
            self.assertEqual(functions.read_text(), original)


if __name__ == "__main__":
    unittest.main()
