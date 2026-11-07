"""Version-one immutable task-file ZIP contract. Standard library, no API imports."""
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import time
import zipfile

PREFIX = "swarm-files-backup-v1-"
NAME = re.compile(r"swarm-files-backup-v1-([0-9]{8}T[0-9]{9}Z)-([0-9a-f]{64})\.zip", re.ASCII)
HEX = re.compile(r"[0-9a-f]{64}", re.ASCII)
SEGMENT = re.compile(r"[A-Za-z0-9._-]+", re.ASCII)
RESERVED = {"CON", "PRN", "AUX", "NUL"} | {f"{p}{i}" for p in ("COM", "LPT") for i in range(1, 10)}
CHUNK = 1024 * 1024


class BackupError(RuntimeError):
    """Stable diagnostic code; never echo untrusted archive names or content."""
    def __init__(self, code):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class Limits:
    max_archive_bytes: int = 256 * 1024 * 1024
    max_total_bytes: int = 512 * 1024 * 1024
    max_files: int = 10000
    max_manifest_bytes: int = 4 * 1024 * 1024

    def __post_init__(self):
        if any(type(n) is not int or n <= 0 for n in (
            self.max_archive_bytes, self.max_total_bytes, self.max_files, self.max_manifest_bytes
        )) or self.max_files > 50000 or max(self.max_archive_bytes, self.max_total_bytes) > 2147483647:
            raise BackupError("invalid_limits")


def check_time(deadline):
    if deadline is not None and time.monotonic() >= deadline:
        raise BackupError("timeout")


def parse_name(name):
    match = NAME.fullmatch(name)
    if not match:
        raise BackupError("invalid_archive_name")
    try:
        created = datetime.strptime(match[1], "%Y%m%dT%H%M%S%fZ").replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise BackupError("invalid_archive_time") from exc
    return created, match[2]


def safe_path(value):
    if type(value) is not str or len(value) > 240:
        raise BackupError("invalid_path")
    parts = value.split("/")
    for part in parts:
        if (not SEGMENT.fullmatch(part) or part in (".", "..") or part.endswith(".")
                or part.split(".", 1)[0].upper() in RESERVED):
            raise BackupError("invalid_path")
    return value


def _unique_json(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise BackupError("duplicate_manifest_key")
        result[key] = value
    return result


def _uint(value):
    return type(value) is int and value >= 0


def _manifest(raw, created, limits):
    try:
        m = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_json)
    except (UnicodeError, ValueError, RecursionError) as exc:
        raise BackupError("invalid_manifest") from exc
    required = {"schema_version", "source_kind", "created_utc", "files", "file_count", "total_bytes"}
    if type(m) is not dict or set(m) != required:
        raise BackupError("invalid_manifest")
    if type(m["schema_version"]) is not int or m["schema_version"] != 1 or m["source_kind"] != "swarm-task-files":
        raise BackupError("unsupported_manifest")
    if m["created_utc"] != created.isoformat(timespec="milliseconds").replace("+00:00", "Z"):
        raise BackupError("timestamp_mismatch")
    if not _uint(m["file_count"]) or not _uint(m["total_bytes"]) or type(m["files"]) is not list:
        raise BackupError("invalid_manifest")
    if len(m["files"]) != m["file_count"] or m["file_count"] > limits.max_files:
        raise BackupError("file_count_limit")
    if m["file_count"] == 0:
        raise BackupError("empty_source")
    seen, total = set(), 0
    for entry in m["files"]:
        if type(entry) is not dict or set(entry) != {"path", "size_bytes", "sha256"}:
            raise BackupError("invalid_manifest_entry")
        path = safe_path(entry["path"])
        if path.casefold() in seen:
            raise BackupError("duplicate_path")
        seen.add(path.casefold())
        if not _uint(entry["size_bytes"]) or type(entry["sha256"]) is not str or not HEX.fullmatch(entry["sha256"]):
            raise BackupError("invalid_manifest_entry")
        total += entry["size_bytes"]
        if total > limits.max_total_bytes:
            raise BackupError("total_size_limit")
    # A file cannot also be a directory needed by another entry. Check the complete
    # casefold set so acceptance never depends on manifest ordering.
    for path in seen:
        parts = path.split("/")
        if any("/".join(parts[:i]) in seen for i in range(1, len(parts))):
            raise BackupError("path_ancestor_conflict")
    if total != m["total_bytes"]:
        raise BackupError("total_size_mismatch")
    return m


def _zip32_preflight(stream, size, limits):
    # Bound central-directory allocation before ZipFile builds one object per entry.
    if size < 22:
        raise BackupError("invalid_zip")
    stream.seek(size - 22)
    sig, disk, cd_disk, disk_count, count, cd_size, cd_offset, comment = struct.unpack("<4s4H2LH", stream.read(22))
    if (sig != b"PK\x05\x06" or disk or cd_disk or comment or disk_count != count
            or count == 65535 or cd_size == 0xFFFFFFFF or cd_offset == 0xFFFFFFFF
            or count < 1 or count > limits.max_files + 1 or cd_offset + cd_size != size - 22):
        raise BackupError("invalid_zip_layout")
    stream.seek(0)
    if stream.read(4) != b"PK\x03\x04":
        raise BackupError("invalid_zip_layout")
    stream.seek(0)


def _read_member(archive, name, limit, deadline):
    digest, result, total = hashlib.sha256(), bytearray(), 0
    with archive.open(name) as src:
        while True:
            check_time(deadline)
            chunk = src.read(min(CHUNK, limit + 1 - total))
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                raise BackupError("entry_size_limit")
            digest.update(chunk)
            if name == "manifest.json":
                result.extend(chunk)
    return bytes(result), total, digest.hexdigest()


def verify_archive(path, limits=Limits(), *, expected_name=None, deadline=None):
    path = Path(path)
    created, expected_sha = parse_name(expected_name or path.name)
    check_time(deadline)
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as src:
            before = os.fstat(src.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_size > limits.max_archive_bytes:
                raise BackupError("archive_size_limit")
            digest = hashlib.sha256()
            while True:
                check_time(deadline)
                chunk = src.read(CHUNK)
                if not chunk:
                    break
                digest.update(chunk)
            if digest.hexdigest() != expected_sha:
                raise BackupError("archive_digest_mismatch")
            _zip32_preflight(src, before.st_size, limits)
            with zipfile.ZipFile(src) as archive:
                infos = archive.infolist()
                seen = set()
                for info in infos:
                    key = info.filename.casefold()
                    if key in seen:
                        raise BackupError("duplicate_zip_entry")
                    seen.add(key)
                    mode = stat.S_IFMT(info.external_attr >> 16)
                    if (info.is_dir() or info.flag_bits & 1 or info.comment
                            or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                            or mode not in (0, stat.S_IFREG)):
                        raise BackupError("invalid_zip_entry")
                    if info.filename != "manifest.json":
                        if not info.filename.startswith("data/"):
                            raise BackupError("unexpected_zip_entry")
                        safe_path(info.filename[5:])
                if "manifest.json" not in {i.filename for i in infos}:
                    raise BackupError("manifest_missing")
                if archive.getinfo("manifest.json").file_size > limits.max_manifest_bytes:
                    raise BackupError("manifest_size_limit")
                raw, _, _ = _read_member(archive, "manifest.json", limits.max_manifest_bytes, deadline)
                manifest = _manifest(raw, created, limits)
                if {i.filename for i in infos} != {"manifest.json"} | {"data/" + e["path"] for e in manifest["files"]}:
                    raise BackupError("archive_entries_mismatch")
                for entry in manifest["files"]:
                    name = "data/" + entry["path"]
                    if archive.getinfo(name).file_size != entry["size_bytes"]:
                        raise BackupError("entry_size_mismatch")
                    _, size, sha = _read_member(archive, name, entry["size_bytes"], deadline)
                    if size != entry["size_bytes"] or sha != entry["sha256"]:
                        raise BackupError("content_digest_mismatch")
            after = os.fstat(src.fileno())
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise BackupError("archive_changed")
            return manifest
    except (OSError, zipfile.BadZipFile, RuntimeError, ValueError, EOFError, struct.error) as exc:
        if isinstance(exc, BackupError):
            raise
        raise BackupError("invalid_archive") from exc
