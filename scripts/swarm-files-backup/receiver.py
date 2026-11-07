#!/usr/bin/env python3
"""Own-prefix Taildrop receipt and offline restore. No global backup integration."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import http.client
import json
import os
import re
import signal
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import tempfile
import time
from urllib.parse import quote
import zipfile

from archive_contract import BackupError, CHUNK, Limits, PREFIX, check_time, parse_name, verify_archive

PIN = "1.104.4"
META_LIMIT = 4 * 1024 * 1024
MAX_STORE = 4 * 1024 * 1024 * 1024
MAX_ARCHIVES = 64


def require_version(data):
    if type(data) is not dict:
        raise BackupError("invalid_version_response")
    daemon = data.get("daemonLong")
    match = re.match(r"^([0-9]+\.[0-9]+\.[0-9]+)(?:-|$)", daemon) if type(daemon) is str else None
    if data.get("short") != PIN or not match or match[1] != PIN:
        raise BackupError("unsupported_tailscale_version")


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private_dir(path):
    path = Path(path)
    if not path.exists() and not path.is_symlink():
        path.mkdir(mode=0o700, parents=True)
    st = path.lstat()
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.geteuid() or stat.S_IMODE(st.st_mode) != 0o700:
        raise BackupError("store_not_private")
    return path


@contextmanager
def store_lock(store):
    base = private_dir(store)
    private_dir(base / "verified")
    fd = os.open(base / ".receiver.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        st = os.fstat(fd)
        if st.st_uid != os.geteuid() or stat.S_IMODE(st.st_mode) != 0o600 or not stat.S_ISREG(st.st_mode):
            raise BackupError("invalid_lock")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise BackupError("receiver_busy") from exc
        yield base / "verified"
    finally:
        os.close(fd)


def read_json(path, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        st = os.fstat(stream.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_size > maximum:
            raise BackupError("invalid_store_state")
        try:
            return json.loads(stream.read(maximum + 1))
        except (ValueError, UnicodeError) as exc:
            raise BackupError("invalid_store_state") from exc


def atomic_json(path, value):
    fd, temporary = tempfile.mkstemp(prefix=".state-", suffix=".part", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, sort_keys=True, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        fsync_dir(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def manifest_hash(manifest):
    return hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def records(verified, limits):
    result = []
    for marker in verified.iterdir():
        if not marker.name.startswith(PREFIX) or not marker.name.endswith(".zip.verified.json"):
            continue
        name = marker.name[:-len(".verified.json")]
        created, _ = parse_name(name)
        value = read_json(marker, limits.max_manifest_bytes + 4096)
        if type(value) is not dict or set(value) != {"archive", "manifest", "verified_utc"} or value["archive"] != name:
            raise BackupError("invalid_store_state")
        m = value["manifest"]
        if (type(m) is not dict or type(m.get("file_count")) is not int or m["file_count"] < 1
                or m.get("created_utc") != created.isoformat(timespec="milliseconds").replace("+00:00", "Z")):
            raise BackupError("invalid_store_state")
        archive = verified / name
        st = archive.lstat()
        if not stat.S_ISREG(st.st_mode) or stat.S_IMODE(st.st_mode) != 0o600:
            raise BackupError("invalid_store_state")
        result.append((created, m["file_count"], name, manifest_hash(m), st.st_mtime, marker.stat().st_mtime))
        if len(result) > MAX_ARCHIVES:
            raise BackupError("store_archive_limit")
    return result


def latest_state(verified, limits, deadline):
    candidates = records(verified, limits)
    if not candidates:
        return None, None
    latest = max(candidates)
    manifest = verify_archive(verified / latest[2], limits, deadline=deadline)
    if manifest_hash(manifest) != latest[3]:
        raise BackupError("store_state_mismatch")
    return latest, manifest


def guard_progress(manifest, created, latest, previous):
    if manifest["file_count"] == 0:
        raise BackupError("empty_source")
    if latest is not None and created >= latest[0]:
        current = {e["path"]: (e["size_bytes"], e["sha256"]) for e in manifest["files"]}
        if any(current.get(e["path"]) != (e["size_bytes"], e["sha256"]) for e in previous["files"]):
            raise BackupError("source_regression")


def cleanup_parts(directory):
    for item in directory.iterdir():
        if not item.name.startswith((".incoming-", ".state-")):
            continue
        if not re.fullmatch(r"\.(incoming|state)-[a-z0-9_]{8}\.part", item.name, re.ASCII):
            raise BackupError("unknown_partial")
        st = item.lstat()
        if (not stat.S_ISREG(st.st_mode) or st.st_uid != os.geteuid()
                or stat.S_IMODE(st.st_mode) != 0o600 or st.st_nlink != 1):
            raise BackupError("invalid_partial")
        item.unlink()
    fsync_dir(directory)


def finish_prune(verified, name, tombstone):
    (verified / name).unlink(missing_ok=True)
    fsync_dir(verified)
    tombstone.unlink()
    fsync_dir(verified)


def recover(verified, limits, deadline, now):
    cleanup_parts(verified)
    cleanup_parts(verified.parent)
    tombstones = list(verified.glob("*.zip.pruning.json"))
    if not tombstones:
        return
    latest, _ = latest_state(verified, limits, deadline)
    if latest is None:
        raise BackupError("prune_recovery_missing_latest")
    cutoff = (now - timedelta(days=14)).timestamp()
    for tombstone in tombstones:
        name = tombstone.name[:-len(".pruning.json")]
        created, _ = parse_name(name)
        value = read_json(tombstone, limits.max_manifest_bytes + 4096)
        if (type(value) is not dict or value.get("archive") != name
                or type(value.get("manifest")) is not dict):
            raise BackupError("invalid_prune_state")
        manifest = value["manifest"]
        count = manifest.get("file_count")
        if (type(count) is not int or (created, count, name) >= latest[:3]
                or max(created.timestamp(), tombstone.stat().st_mtime) >= cutoff):
            raise BackupError("invalid_prune_state")
        archive = verified / name
        if archive.exists() or archive.is_symlink():
            original = verify_archive(archive, limits, deadline=deadline)
            if manifest_hash(original) != manifest_hash(manifest):
                raise BackupError("invalid_prune_state")
        finish_prune(verified, name, tombstone)


def capacity(verified, incoming, limits, *, temporary=False):
    count, size = 0, 0
    for item in verified.iterdir():
        st = item.lstat()
        if not stat.S_ISREG(st.st_mode):
            raise BackupError("unexpected_store_entry")
        size += st.st_size
        if item.name.startswith(PREFIX) and item.name.endswith(".zip"):
            parse_name(item.name)
            count += 1
    # One bounded in-flight ZIP may precede pruning. Invalid/regressing input never prunes.
    budget = MAX_STORE + limits.max_archive_bytes if temporary else MAX_STORE
    if ((not temporary and count >= MAX_ARCHIVES)
            or size + incoming + limits.max_manifest_bytes + 4096 > budget):
        raise BackupError("store_capacity")
    if shutil.disk_usage(verified).free < incoming + limits.max_manifest_bytes + CHUNK:
        raise BackupError("disk_capacity")


def prune(verified, limits, deadline, now, keep=()):
    latest, _ = latest_state(verified, limits, deadline)
    candidates = records(verified, limits)
    newest = latest[2] if latest else None
    cutoff = (now - timedelta(days=14)).timestamp()
    for created, _, name, _, archive_mtime, marker_mtime in candidates:
        check_time(deadline)
        if name == newest or name in keep or max(created.timestamp(), archive_mtime, marker_mtime) >= cutoff:
            continue
        marker = verified / (name + ".verified.json")
        tombstone = verified / (name + ".pruning.json")
        if tombstone.exists() or tombstone.is_symlink():
            raise BackupError("prune_recovery_required")
        os.rename(marker, tombstone)
        fsync_dir(verified)
        finish_prune(verified, name, tombstone)


def _receive_one(client, verified, name, limits, deadline, now):
    created, _ = parse_name(name)
    check_time(deadline)
    latest, previous = latest_state(verified, limits, deadline)
    final = verified / name
    part = None
    is_new = not (final.exists() or final.is_symlink())
    try:
        if is_new:
            with client.open_file(name) as (src, declared):
                if type(declared) is not int or declared < 0 or declared > limits.max_archive_bytes:
                    raise BackupError("archive_size_limit")
                capacity(verified, declared, limits, temporary=True)
                fd, temporary = tempfile.mkstemp(prefix=".incoming-", suffix=".part", dir=verified)
                part = Path(temporary)
                total = 0
                with os.fdopen(fd, "wb") as out:
                    while True:
                        check_time(deadline)
                        chunk = src.read(min(CHUNK, declared + 1 - total))
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > declared:
                            raise BackupError("download_size_mismatch")
                        out.write(chunk)
                    if total != declared:
                        raise BackupError("download_size_mismatch")
                    out.flush()
                    os.fsync(out.fileno())
            manifest = verify_archive(part, limits, expected_name=name, deadline=deadline)
            guard_progress(manifest, created, latest, previous)
            prune(verified, limits, deadline, now, keep=(latest[2],) if latest else ())
            capacity(verified, 0, limits)
            # link is an atomic, exclusive publish; an existing immutable ZIP is never replaced.
            os.link(part, final, follow_symlinks=False)
            part.unlink()
            part = None
        else:
            manifest = verify_archive(final, limits, deadline=deadline)
            guard_progress(manifest, created, latest, previous)
            fd = os.open(final, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        fsync_dir(verified)
        atomic_json(verified / (name + ".verified.json"), {
            "archive": name, "manifest": manifest,
            "verified_utc": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        })
        try:
            client.delete(name)
        except (BackupError, OSError) as exc:
            raise BackupError("delete_failed_after_verify") from exc
        is_latest = latest is None or created >= latest[0]
        if is_latest:
            atomic_json(verified.parent / "last-success.json", {
                "archive": name, "created_utc": manifest["created_utc"],
                "verified_utc": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                "file_count": manifest["file_count"], "total_bytes": manifest["total_bytes"],
            })
        if is_new:
            prune(verified, limits, deadline, now, keep=(latest[2],) if latest else ())
        return {"new": is_new, "latest": is_latest, "file_count": manifest["file_count"], "total_bytes": manifest["total_bytes"]}
    finally:
        if part is not None:
            part.unlink(missing_ok=True)


def receive_one(client, store, name, limits=Limits(), *, deadline=None, now=None):
    now = now or datetime.now(timezone.utc)
    try:
        with store_lock(store) as verified:
            recover(verified, limits, deadline, now)
            return _receive_one(client, verified, name, limits, deadline, now)
    except OSError as exc:
        raise BackupError("filesystem_failed") from exc


class UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path, timeout):
        super().__init__("local-tailscaled.sock", timeout=timeout)
        self.socket_path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.socket_path)


class Taildrop:
    def __init__(self, socket_path, deadline, executable="tailscale"):
        self.socket_path, self.deadline, self.executable = socket_path, deadline, executable

    def version(self):
        try:
            r = subprocess.run([self.executable, "version", "--daemon", "--json"],
                               capture_output=True, timeout=min(10, self.remaining()), check=True)
            if len(r.stdout) > 65536:
                raise BackupError("invalid_version_response")
            require_version(json.loads(r.stdout))
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            raise BackupError("version_check_failed") from exc

    def remaining(self):
        check_time(self.deadline)
        return max(0.01, self.deadline - time.monotonic())

    @contextmanager
    def request(self, method, path, expected):
        conn = UnixHTTP(self.socket_path, min(10, self.remaining()))
        try:
            conn.request(method, path)
            response = conn.getresponse()
            if response.status != expected:
                raise BackupError("localapi_status")
            yield response
        except (OSError, http.client.HTTPException) as exc:
            raise BackupError("localapi_failed") from exc
        finally:
            conn.close()

    def waiting(self):
        with self.request("GET", "/localapi/v0/files/?waitsec=0", 200) as response:
            raw = response.read(META_LIMIT + 1)
            if len(raw) > META_LIMIT:
                raise BackupError("queue_size_limit")
            try:
                items = json.loads(raw)
            except (ValueError, UnicodeError) as exc:
                raise BackupError("invalid_queue") from exc
            if items is None:
                return []
            if type(items) is not list:
                raise BackupError("invalid_queue")
            return items

    @contextmanager
    def open_file(self, name):
        parse_name(name)
        with self.request("GET", "/localapi/v0/files/" + quote(name, safe=""), 200) as response:
            try:
                length = int(response.getheader("Content-Length", "-1"))
            except ValueError as exc:
                raise BackupError("invalid_download_length") from exc
            yield response, length

    def delete(self, name):
        parse_name(name)
        with self.request("DELETE", "/localapi/v0/files/" + quote(name, safe=""), 204):
            pass


def receive_batch(client, store, limits=Limits(), *, deadline, now=None):
    now = now or datetime.now(timezone.utc)
    result = {"status": "ok", "received": 0, "already_verified": 0, "errors": []}
    with store_lock(store) as verified:
        client.version()
        recover(verified, limits, deadline, now)
        candidates = []
        for item in client.waiting():
            if type(item) is not dict or type(item.get("Name")) is not str:
                raise BackupError("invalid_queue")
            name = item["Name"]
            if not name.startswith(PREFIX):
                continue
            try:
                created, _ = parse_name(name)
                if type(item.get("Size")) is not int or not 0 <= item["Size"] <= limits.max_archive_bytes:
                    raise BackupError("archive_size_limit")
                candidates.append((created, name))
            except BackupError as exc:
                result["errors"].append(exc.code)
        for _, name in sorted(set(candidates))[:4]:
            try:
                value = _receive_one(client, verified, name, limits, deadline, now)
                result["received" if value["new"] else "already_verified"] += 1
            except (BackupError, OSError) as exc:
                result["errors"].append(exc.code if isinstance(exc, BackupError) else "filesystem_failed")
        if result["errors"]:
            result["status"] = "error"
    return result


def restore(archive, destination, limits=Limits(), *, deadline=None):
    destination = Path(destination)
    if destination.exists() or destination.is_symlink():
        raise BackupError("restore_destination_exists")
    manifest = verify_archive(archive, limits, deadline=deadline)
    # mkdir is the exclusive reservation; no rename can replace a racing empty tree.
    try:
        destination.mkdir(mode=0o700)
    except FileExistsError as exc:
        raise BackupError("restore_destination_exists") from exc
    identity = destination.stat().st_ino
    success = False
    try:
        with zipfile.ZipFile(archive) as source:
            for entry in manifest["files"]:
                target = destination / entry["path"]
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                digest, size = hashlib.sha256(), 0
                with os.fdopen(fd, "wb") as out, source.open("data/" + entry["path"]) as src:
                    while True:
                        check_time(deadline)
                        chunk = src.read(CHUNK)
                        if not chunk:
                            break
                        size += len(chunk)
                        if size > entry["size_bytes"]:
                            raise BackupError("restore_size_mismatch")
                        digest.update(chunk)
                        out.write(chunk)
                    out.flush()
                    os.fsync(out.fileno())
                if size != entry["size_bytes"] or digest.hexdigest() != entry["sha256"]:
                    raise BackupError("restore_digest_mismatch")
        for directory, _, _ in os.walk(destination, topdown=False):
            fsync_dir(directory)
        fsync_dir(destination.parent)
        success = True
        return {"status": "ok", "file_count": manifest["file_count"], "total_bytes": manifest["total_bytes"]}
    finally:
        if (not success and not destination.is_symlink() and destination.exists()
                and destination.stat().st_ino == identity):
            shutil.rmtree(destination)


@contextmanager
def deadline_alarm(seconds):
    def expired(_signum, _frame):
        raise BackupError("timeout")
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def main():
    global MAX_STORE, MAX_ARCHIVES
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("receive", "verify", "restore"))
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--store", type=Path, default=Path("/var/backups/swarm-files"))
    parser.add_argument("--socket", default="/var/run/tailscale/tailscaled.sock")
    parser.add_argument("--tailscale", default="tailscale")
    parser.add_argument("--max-archive", type=int, default=Limits().max_archive_bytes)
    parser.add_argument("--max-total", type=int, default=Limits().max_total_bytes)
    parser.add_argument("--max-count", type=int, default=Limits().max_files)
    parser.add_argument("--max-stored-bytes", type=int, default=MAX_STORE)
    parser.add_argument("--max-stored-count", type=int, default=MAX_ARCHIVES)
    parser.add_argument("--timeout", type=float, default=120)
    args = parser.parse_args()
    try:
        if not 0 < args.timeout <= 600:
            raise BackupError("invalid_timeout")
        limits = Limits(args.max_archive, args.max_total, args.max_count)
        if args.max_stored_bytes <= limits.max_archive_bytes or not 2 <= args.max_stored_count <= 1024:
            raise BackupError("invalid_store_limits")
        MAX_STORE, MAX_ARCHIVES = args.max_stored_bytes, args.max_stored_count
        deadline = time.monotonic() + args.timeout
        with deadline_alarm(args.timeout):
            if args.action == "receive":
                result = receive_batch(Taildrop(args.socket, deadline, args.tailscale), args.store, limits, deadline=deadline)
            elif args.action == "restore":
                if args.archive is None or args.destination is None:
                    raise BackupError("missing_restore_arguments")
                result = restore(args.archive, args.destination, limits, deadline=deadline)
            else:
                if args.archive is None:
                    raise BackupError("missing_archive_argument")
                m = verify_archive(args.archive, limits, deadline=deadline)
                result = {"status": "ok", "file_count": m["file_count"], "total_bytes": m["total_bytes"]}
        print(json.dumps(result, sort_keys=True))
        return 1 if result["status"] == "error" else 0
    except (BackupError, OSError, zipfile.BadZipFile) as exc:
        print(json.dumps({"status": "error", "code": exc.code if isinstance(exc, BackupError) else "filesystem_failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
