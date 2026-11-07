"""Synthetic archive integrity regressions; no host services or actual attachments."""
import hashlib
import json
import tempfile
import unittest
import zipfile
from dataclasses import replace
from pathlib import Path

from archive_contract import BackupError, Limits, verify_archive

STAMP = "20261107T120000123Z"
CREATED = "2026-11-07T12:00:00.123Z"


def make_archive(root, files=None, *, mutate=None, extra=None, stamp=STAMP, created=CREATED):
    files = {"object-1": b"synthetic bytes"} if files is None else files
    manifest = {
        "schema_version": 1, "source_kind": "swarm-task-files", "created_utc": created,
        "files": [{"path": p, "size_bytes": len(b), "sha256": hashlib.sha256(b).hexdigest()}
                  for p, b in sorted(files.items())],
        "file_count": len(files), "total_bytes": sum(map(len, files.values())),
    }
    if mutate:
        mutate(manifest)
    scratch = Path(root) / "fixture.zip"
    with zipfile.ZipFile(scratch, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest).encode())
        for name, content in files.items():
            archive.writestr("data/" + name, content)
        for name, content in extra or []:
            archive.writestr(name, content)
    name = "swarm-files-backup-v1-" + stamp + "-" + hashlib.sha256(scratch.read_bytes()).hexdigest() + ".zip"
    path = Path(root) / name
    scratch.rename(path)
    return path


class ArchiveFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def reject(self, **kwargs):
        path = make_archive(self.root, **kwargs)
        with self.assertRaises(BackupError):
            verify_archive(path)


class ArchiveContractTests(ArchiveFixture):
    def test_valid_archive(self):
        manifest = verify_archive(make_archive(self.root))
        self.assertEqual((manifest["file_count"], manifest["total_bytes"]), (1, 15))

    def test_wrong_archive_digest_is_rejected(self):
        path = make_archive(self.root)
        wrong = path.with_name(path.name[:-68] + "0" * 64 + ".zip")
        path.rename(wrong)
        with self.assertRaises(BackupError):
            verify_archive(wrong)

    def test_wrong_content_digest_is_rejected(self):
        self.reject(mutate=lambda m: m["files"][0].update(sha256="0" * 64))

    def test_traversal_is_rejected(self):
        self.reject(files={"../escape": b"x"})

    def test_extra_payload_is_rejected(self):
        self.reject(extra=[("data/unlisted", b"extra")])

    def test_false_total_is_rejected(self):
        self.reject(mutate=lambda m: m.update(total_bytes=999))

    def test_count_limit_is_enforced(self):
        path = make_archive(self.root, {"a": b"a", "b": b"b"})
        with self.assertRaises(BackupError):
            verify_archive(path, replace(Limits(), max_files=1))

class EmptySourceTests(unittest.TestCase):
    def test_empty_first_snapshot_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(BackupError):
                verify_archive(make_archive(root, {}))

class AdditionalArchiveTests(ArchiveFixture):
    def test_reserved_backslash_and_case_collisions_rejected(self):
        for name in ("CON.txt", "a\\b", "a//b", "/a", "a.", "caf\u00e9"):
            with self.subTest(name=name):
                self.reject(files={name: b"x"})
        self.reject(files={"a": b"one", "A": b"two"})

    def test_size_timestamp_boolean_and_unknown_fields_rejected(self):
        mutations = [lambda m: m.update(schema_version=True), lambda m: m.update(file_count=True),
                     lambda m: m.update(created_utc="2026-11-07T12:00:01.123Z"),
                     lambda m: m.update(extra="no"), lambda m: m["files"][0].update(size_bytes=500)]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.reject(mutate=mutation)

    def test_duplicate_zip_entry_rejected(self):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            self.reject(extra=[("data/object-1", b"duplicate")])

    def test_archive_limit_and_deadline_enforced(self):
        import time
        path = make_archive(self.root)
        with self.assertRaises(BackupError):
            verify_archive(path, replace(Limits(), max_archive_bytes=10))
        with self.assertRaisesRegex(BackupError, "timeout"):
            verify_archive(path, deadline=time.monotonic() - 1)

    def test_symlink_zip_entry_rejected(self):
        source = make_archive(self.root)
        work = self.root / "symlink.zip"
        with zipfile.ZipFile(source) as old, zipfile.ZipFile(work, "w") as new:
            for info in old.infolist():
                if info.filename.startswith("data/"):
                    info.create_system = 3
                    info.external_attr = 0o120777 << 16
                new.writestr(info, old.read(info.filename))
        name = "swarm-files-backup-v1-" + STAMP + "-" + hashlib.sha256(work.read_bytes()).hexdigest() + ".zip"
        work.rename(self.root / name)
        with self.assertRaises(BackupError):
            verify_archive(self.root / name)


class PathTreeTests(ArchiveFixture):
    def test_file_ancestor_conflicts_rejected_in_either_order_and_case(self):
        for ancestor, child in (("a", "a/b"), ("A", "a/b")):
            for reverse in (False, True):
                with self.subTest(ancestor=ancestor, reverse=reverse):
                    mutate = (lambda m: m["files"].reverse()) if reverse else None
                    self.reject(files={ancestor: b"one", child: b"two"}, mutate=mutate)

    def test_siblings_and_segment_boundaries_are_restorable(self):
        path = make_archive(self.root, {"a/b": b"one", "a/c": b"two", "ab": b"three"})
        manifest = verify_archive(path)
        self.assertEqual(manifest["file_count"], 3)


if __name__ == "__main__":
    unittest.main()
