"""Offline receive/restore tests. Fake LocalAPI, tiny synthetic ZIPs only."""
from contextlib import contextmanager
from datetime import datetime, timezone
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from archive_contract import BackupError
import receiver
from test_archive_contract import make_archive


class FakeClient:
    def __init__(self, paths):
        self.payloads = {p.name: p.read_bytes() for p in paths}
        self.calls = []
        self.delete_error = False

    @contextmanager
    def open_file(self, name):
        self.calls.append(("GET", name))
        payload = self.payloads[name]
        yield io.BytesIO(payload), len(payload)

    def delete(self, name):
        self.calls.append(("DELETE", name))
        if self.delete_error:
            raise BackupError("localapi_failed")
        self.payloads.pop(name, None)


class ReceiverFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.store = self.root / "store"
        self.now = datetime(2026, 11, 7, 14, tzinfo=timezone.utc)


class ReceiveTests(ReceiverFixture):
    def test_valid_archive_is_saved_before_delete(self):
        path = make_archive(self.root)
        client = FakeClient([path])
        receiver.receive_one(client, self.store, path.name, now=self.now)
        self.assertEqual((self.store / "verified" / path.name).read_bytes(), path.read_bytes())
        self.assertEqual(client.calls[-1], ("DELETE", path.name))

    def test_fsync_failure_never_deletes_inbox(self):
        path = make_archive(self.root)
        client = FakeClient([path])
        with patch.object(receiver.os, "fsync", side_effect=OSError("synthetic failure")):
            with self.assertRaises(BackupError):
                receiver.receive_one(client, self.store, path.name, now=self.now)
        self.assertFalse(any(method == "DELETE" for method, _ in client.calls))

    def test_new_source_cannot_lose_a_verified_path(self):
        first = make_archive(self.root, {"a": b"one", "b": b"two"})
        receiver.receive_one(FakeClient([first]), self.store, first.name, now=self.now)
        smaller = make_archive(self.root, {"a": b"one"}, stamp="20261107T130000123Z",
                               created="2026-11-07T13:00:00.123Z")
        client = FakeClient([smaller])
        with self.assertRaises(BackupError):
            receiver.receive_one(client, self.store, smaller.name, now=self.now)
        self.assertFalse((self.store / "verified" / smaller.name).exists())
        self.assertFalse(any(method == "DELETE" for method, _ in client.calls))

class RecoveryTests(ReceiverFixture):
    def test_nonobject_version_rejected_explicitly(self):
        for value in (None, [], "1.104.4"):
            with self.subTest(type=type(value).__name__), self.assertRaises(BackupError):
                receiver.require_version(value)

    def test_orphan_parts_removed_under_exclusive_lock(self):
        verified = receiver.private_dir(receiver.private_dir(self.store) / "verified")
        parts = [verified / ".incoming-abcd1234.part", verified / ".state-abcd1234.part",
                 self.store / ".state-abcd1234.part"]
        for path in parts:
            path.write_bytes(b"abandoned")
            path.chmod(0o600)
        archive = make_archive(self.root)
        receiver.receive_one(FakeClient([archive]), self.store, archive.name, now=self.now)
        self.assertTrue(all(not path.exists() for path in parts))

    def test_restore_preserves_concurrently_created_empty_destination(self):
        source = make_archive(self.root)
        destination = self.root / "restore"
        real_exists, real_mkdir, path_mkdir = Path.exists, os.mkdir, Path.mkdir
        checks, contender_inode = [0], []

        def compete():
            if not contender_inode:
                real_mkdir(destination, 0o700)
                contender_inode.append(destination.stat().st_ino)

        def exists(path):
            result = real_exists(path)
            if path == destination and not result:
                checks[0] += 1
                if checks[0] >= 2:
                    compete()
            return result

        def mkdir(path, *args, **kwargs):
            if path == destination:
                compete()
            return path_mkdir(path, *args, **kwargs)

        with patch.object(Path, "exists", exists), patch.object(Path, "mkdir", mkdir):
            with self.assertRaises(BackupError):
                receiver.restore(source, destination)
        self.assertEqual(destination.stat().st_ino, contender_inode[0])
        self.assertEqual(list(destination.iterdir()), [])

    def test_full_expired_store_can_accept_new_snapshot(self):
        from datetime import timedelta
        verified = receiver.private_dir(receiver.private_dir(self.store) / "verified")
        archives = []
        for i in range(64):
            created = self.now - timedelta(days=100 - i)
            stamp = created.strftime("%Y%m%dT%H%M%S") + "000Z"
            iso = created.isoformat(timespec="milliseconds").replace("+00:00", "Z")
            path = make_archive(self.root, {"a": b"one"}, stamp=stamp, created=iso)
            target = verified / path.name
            target.write_bytes(path.read_bytes())
            target.chmod(0o600)
            manifest = receiver.verify_archive(target)
            marker = verified / (path.name + ".verified.json")
            receiver.atomic_json(marker, {"archive": path.name, "manifest": manifest, "verified_utc": iso})
            for file in (target, marker):
                os.utime(file, (created.timestamp(), created.timestamp()))
            archives.append(target)
        new = make_archive(self.root, {"a": b"one", "b": b"two"})
        receiver.receive_one(FakeClient([new]), self.store, new.name, now=self.now)
        self.assertTrue((verified / new.name).exists())
        self.assertTrue(archives[-1].exists())
        self.assertLess(len(list(verified.glob("*.zip"))), 64)

class ReceiveEdgeTests(ReceiverFixture):
    def test_delete_observes_fsynced_data_marker_and_directory(self):
        import stat
        source = make_archive(self.root)
        client = FakeClient([source])
        events = []
        actual_fsync, actual_delete = os.fsync, client.delete

        def sync(fd):
            info = os.fstat(fd)
            events.append((info.st_ino, stat.S_ISDIR(info.st_mode)))
            actual_fsync(fd)

        def delete(name):
            final = self.store / "verified" / name
            marker = final.with_name(name + ".verified.json")
            data_index = events.index((final.stat().st_ino, False))
            marker_index = events.index((marker.stat().st_ino, False))
            directory_indices = [i for i, item in enumerate(events)
                                 if item == (final.parent.stat().st_ino, True)]
            self.assertLess(data_index, marker_index)
            self.assertTrue(directory_indices and max(directory_indices) > marker_index)
            actual_delete(name)

        client.delete = delete
        with patch.object(os, "fsync", sync):
            receiver.receive_one(client, self.store, source.name, now=self.now)

    def test_delete_failure_retry_reuses_immutable_verified_zip(self):
        path = make_archive(self.root)
        client = FakeClient([path])
        client.delete_error = True
        with self.assertRaisesRegex(BackupError, "delete_failed_after_verify"):
            receiver.receive_one(client, self.store, path.name, now=self.now)
        final = self.store / "verified" / path.name
        before = final.stat()
        self.assertTrue(final.with_name(final.name + ".verified.json").exists())
        self.assertFalse((self.store / "last-success.json").exists())
        client.calls.clear()
        client.delete_error = False
        receiver.receive_one(client, self.store, path.name, now=self.now)
        self.assertEqual(client.calls, [("DELETE", path.name)])
        self.assertEqual((final.stat().st_ino, final.stat().st_mtime_ns), (before.st_ino, before.st_mtime_ns))

    def test_older_valid_snapshot_does_not_replace_latest_state(self):
        latest = make_archive(self.root, {"a": b"one", "b": b"two"},
                              stamp="20261107T130000123Z", created="2026-11-07T13:00:00.123Z")
        receiver.receive_one(FakeClient([latest]), self.store, latest.name, now=self.now)
        previous = (self.store / "last-success.json").read_bytes()
        older = make_archive(self.root, {"a": b"one"})
        client = FakeClient([older])
        value = receiver.receive_one(client, self.store, older.name, now=self.now)
        self.assertFalse(value["latest"])
        self.assertEqual(previous, (self.store / "last-success.json").read_bytes())
        self.assertEqual(client.calls[-1], ("DELETE", older.name))

    def test_same_path_changed_content_rejected_without_publish_or_success_refresh(self):
        first = make_archive(self.root, {"a": b"original"})
        receiver.receive_one(FakeClient([first]), self.store, first.name, now=self.now)
        previous = (self.store / "last-success.json").read_bytes()
        changed = make_archive(self.root, {"a": b"changed"}, stamp="20261107T130000123Z",
                               created="2026-11-07T13:00:00.123Z")
        client = FakeClient([changed])
        with self.assertRaisesRegex(BackupError, "source_regression"):
            receiver.receive_one(client, self.store, changed.name, now=self.now)
        self.assertEqual(previous, (self.store / "last-success.json").read_bytes())
        self.assertFalse((self.store / "verified" / changed.name).exists())
        self.assertNotIn(("DELETE", changed.name), client.calls)

    def test_batch_never_reads_or_deletes_foreign_inbox_payload(self):
        path = make_archive(self.root)
        client = FakeClient([path])
        client.payloads["unrelated.txt"] = b"preserve"
        client.version = lambda: receiver.require_version({"short": "1.104.4", "daemonLong": "1.104.4-platform"})
        client.waiting = lambda: [{"Name": n, "Size": len(b)} for n, b in client.payloads.items()]
        import time
        value = receiver.receive_batch(client, self.store, deadline=time.monotonic() + 5, now=self.now)
        self.assertEqual(value["status"], "ok")
        self.assertEqual(client.payloads["unrelated.txt"], b"preserve")
        self.assertTrue(all(name == path.name for _, name in client.calls))

    def test_version_missing_mismatched_and_wrong_type_fail_closed(self):
        cases = [None, [], {"short": "1.104.4"},
                 {"short": "1.104.4", "daemonLong": "1.104.3-old"},
                 {"short": "1.104.5", "daemonLong": "1.104.4-platform"}]
        for data in cases:
            with self.subTest(value=data), self.assertRaises(BackupError):
                receiver.require_version(data)

    def test_restore_is_new_private_and_matches_all_manifest_bytes(self):
        import hashlib
        source = make_archive(self.root, {"a": b"one", "nested/b": b"two", "zero": b""})
        destination = self.root / "restored"
        receiver.restore(source, destination)
        self.assertEqual(destination.stat().st_mode & 0o777, 0o700)
        for name, content in {"a": b"one", "nested/b": b"two", "zero": b""}.items():
            path = destination / name
            self.assertEqual(hashlib.sha256(path.read_bytes()).digest(), hashlib.sha256(content).digest())
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        with self.assertRaisesRegex(BackupError, "restore_destination_exists"):
            receiver.restore(source, destination)

    def test_unknown_and_symlink_parts_are_not_deleted(self):
        verified = receiver.private_dir(receiver.private_dir(self.store) / "verified")
        foreign = verified / ".incoming-unknown-owner.part"
        foreign.write_bytes(b"preserve")
        archive = make_archive(self.root)
        with self.assertRaises(BackupError):
            receiver.receive_one(FakeClient([archive]), self.store, archive.name, now=self.now)
        self.assertEqual(foreign.read_bytes(), b"preserve")
        foreign.unlink()
        target = self.root / "foreign"
        target.write_bytes(b"preserve")
        (verified / ".incoming-abcd1234.part").symlink_to(target)
        with self.assertRaises(BackupError):
            receiver.receive_one(FakeClient([archive]), self.store, archive.name, now=self.now)
        self.assertEqual(target.read_bytes(), b"preserve")

    def test_lock_prevents_overlapping_receiver(self):
        with receiver.store_lock(self.store):
            with self.assertRaisesRegex(BackupError, "receiver_busy"):
                with receiver.store_lock(self.store):
                    self.fail("overlapping receiver acquired lock")

    def test_hard_deadline_interrupts_blocked_action(self):
        import time
        with self.assertRaisesRegex(BackupError, "timeout"):
            with receiver.deadline_alarm(0.01):
                time.sleep(0.1)

    def test_prune_crash_between_delete_operations_recovers(self):
        from datetime import timedelta
        verified = receiver.private_dir(receiver.private_dir(self.store) / "verified")
        old_time = self.now - timedelta(days=40)
        old = make_archive(self.root, {"a": b"one"},
                           stamp=old_time.strftime("%Y%m%dT%H%M%S") + "000Z",
                           created=old_time.isoformat(timespec="milliseconds").replace("+00:00", "Z"))
        final = verified / old.name
        final.write_bytes(old.read_bytes())
        final.chmod(0o600)
        marker = verified / (old.name + ".verified.json")
        receiver.atomic_json(marker, {"archive": old.name, "manifest": receiver.verify_archive(final),
                                      "verified_utc": "2026-09-28T14:00:00.000Z"})
        for item in (final, marker):
            os.utime(item, (old_time.timestamp(), old_time.timestamp()))
        latest = make_archive(self.root, {"a": b"one", "b": b"two"})
        receiver.receive_one(FakeClient([latest]), self.store, latest.name, now=self.now)
        # Kept previous newest on the prior run; it becomes eligible on this next run.
        new = make_archive(self.root, {"a": b"one", "b": b"two", "c": b"three"},
                           stamp="20261107T130000123Z", created="2026-11-07T13:00:00.123Z")
        real_unlink = Path.unlink
        failed = [False]

        def unlink(path, *args, **kwargs):
            if (path.name in (old.name + ".verified.json", old.name + ".pruning.json")
                    and not final.exists() and not failed[0]):
                failed[0] = True
                raise OSError("synthetic interruption after archive delete")
            return real_unlink(path, *args, **kwargs)

        client = FakeClient([new])
        with patch.object(Path, "unlink", unlink):
            with self.assertRaises(BackupError):
                receiver.receive_one(client, self.store, new.name, now=self.now)
        self.assertTrue(failed[0])
        self.assertTrue((verified / latest.name).exists())
        receiver.receive_one(client, self.store, new.name, now=self.now)
        self.assertFalse(list(verified.glob("*.pruning.json")))
        self.assertTrue((verified / new.name).exists())

class PublishLinkRecoveryTests(ReceiverFixture):
    def linked(self, *, third=False, own_final=True):
        source = make_archive(self.root)
        verified = receiver.private_dir(receiver.private_dir(self.store) / "verified")
        part = verified / ".incoming-abcd1234.part"
        part.write_bytes(source.read_bytes())
        part.chmod(0o600)
        final = verified / (source.name if own_final else "foreign.zip")
        os.link(part, final)
        if third:
            os.link(part, self.root / "external-link")
        return source, part, final

    def test_retry_after_link_before_unlink_preserves_final_and_acks_exactly_once(self):
        source, part, final = self.linked()
        identity = final.stat()
        client = FakeClient([source])
        value = receiver.receive_one(client, self.store, source.name, now=self.now)
        self.assertFalse(value["new"])
        self.assertFalse(part.exists())
        self.assertEqual(final.read_bytes(), source.read_bytes())
        self.assertEqual((final.stat().st_ino, final.stat().st_mtime_ns),
                         (identity.st_ino, identity.st_mtime_ns))
        self.assertEqual(final.stat().st_nlink, 1)
        self.assertEqual(client.calls, [("DELETE", source.name)])
        self.assertTrue(final.with_name(final.name + ".verified.json").exists())

    def test_foreign_or_third_links_are_never_removed(self):
        for third, own_final in ((True, True), (False, False)):
            with self.subTest(third=third), tempfile.TemporaryDirectory() as temporary:
                original_root, original_store = self.root, self.store
                self.root, self.store = Path(temporary), Path(temporary) / "store"
                try:
                    source, part, final = self.linked(third=third, own_final=own_final)
                    client = FakeClient([source])
                    with self.assertRaisesRegex(BackupError, "invalid_partial"):
                        receiver.receive_one(client, self.store, source.name, now=self.now)
                    self.assertTrue(part.exists())
                    self.assertEqual(final.read_bytes(), source.read_bytes())
                    self.assertEqual(client.calls, [])
                finally:
                    self.root, self.store = original_root, original_store

    def test_linked_corrupt_final_is_preserved_without_ack(self):
        source, part, final = self.linked()
        with final.open("r+b") as stream:
            stream.write(b"corrupt")
        before = final.read_bytes()
        client = FakeClient([source])
        with self.assertRaises(BackupError):
            receiver.receive_one(client, self.store, source.name, now=self.now)
        self.assertEqual(final.read_bytes(), before)
        self.assertTrue(part.exists())
        self.assertEqual(client.calls, [])


if __name__ == "__main__":
    unittest.main()
