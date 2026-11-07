"""Prove integrity regressions fail on deliberately broken in-memory copies."""
import io
from pathlib import Path
import types
import unittest
from unittest.mock import patch

import archive_contract
import receiver
import test_archive_contract
import test_receiver


def expect_failure(name, suite):
    output = io.StringIO()
    result = unittest.TextTestRunner(stream=output).run(suite)
    if result.testsRun != 1 or len(result.failures) != 1 or result.errors:
        raise RuntimeError("negative_control_not_detected: " + name)
    print("PASS negative_control " + name)


def main():
    source = Path(archive_contract.__file__).read_text()
    target = 'if size != entry["size_bytes"] or sha != entry["sha256"]:'
    if source.count(target) != 1:
        raise RuntimeError("negative_control_anchor_changed")
    mutant = types.ModuleType("archive_contract_mutant")
    mutant.__file__ = archive_contract.__file__
    # Dataclasses resolves its module while constructing classes.
    import sys
    sys.modules[mutant.__name__] = mutant
    try:
        exec(compile(source.replace(target, "if False:"), mutant.__file__, "exec"), mutant.__dict__)
        with patch.object(test_archive_contract, "verify_archive", mutant.verify_archive):
            suite = unittest.defaultTestLoader.loadTestsFromName(
                "ArchiveContractTests.test_wrong_content_digest_is_rejected", test_archive_contract)
            expect_failure("content_digest", suite)
    finally:
        sys.modules.pop(mutant.__name__, None)
    with patch.object(receiver, "guard_progress", lambda *_args: None):
        suite = unittest.defaultTestLoader.loadTestsFromName(
            "ReceiveTests.test_new_source_cannot_lose_a_verified_path", test_receiver)
        expect_failure("immutable_source_superset", suite)

    with patch.object(receiver, "fsync_dir", lambda *_args: None):
        suite = unittest.defaultTestLoader.loadTestsFromName(
            "ReceiveEdgeTests.test_delete_observes_fsynced_data_marker_and_directory", test_receiver)
        expect_failure("durable_directory_before_ack", suite)


if __name__ == "__main__":
    main()
