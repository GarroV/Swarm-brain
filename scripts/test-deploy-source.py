#!/usr/bin/env python3
"""Exercise go in disposable real git repos; the deploy transport is a local recorder."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get("DEPLOY_SOURCE_SCRIPT", ROOT / "scripts/deploy-window.sh"))


def git(cwd, *args):
    return subprocess.check_output(["git", "-c", "core.hooksPath=/dev/null", "-C", str(cwd), *args],
                                   text=True, stderr=subprocess.PIPE).strip()


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name).resolve()
        self.remote = self.base / "origin.git"
        self.repo = self.base / "release"
        self.calls = self.base / "deploy-calls"
        self.remote.mkdir()
        git(self.remote, "init", "--bare", "--initial-branch=main")
        self.repo.mkdir()
        git(self.repo, "init", "--initial-branch=main")
        git(self.repo, "config", "user.email", "fixture@example.invalid")
        git(self.repo, "config", "user.name", "Fixture")
        git(self.repo, "remote", "add", "origin", str(self.remote))
        scripts = self.repo / "scripts"
        (scripts / "lib").mkdir(parents=True)
        shutil.copyfile(SOURCE, scripts / "deploy-window.sh")
        shutil.copyfile(ROOT / "scripts/lib/migrations-gate.sh", scripts / "lib/migrations-gate.sh")
        (scripts / "lib/swarm-server.sh").write_text('''swarm_server() {
  [ "$1" = functions ] || return 99
  cat >/dev/null
  printf 'functions\\n' >> "$DEPLOY_CALLS"
}
''')
        (scripts / "deploy-notice.sh").write_text("#!/bin/bash\nexit 0\n")
        (scripts / "deploy-notice.sh").chmod(0o755)
        self.probe = self.repo / "supabase/functions/probe/index.ts"
        self.probe.parent.mkdir(parents=True)
        self.probe.write_text("export const value = 0;\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "base")
        self.tag = git(self.repo, "rev-parse", "HEAD")
        git(self.repo, "tag", "prod-deployed")
        self.probe.write_text("export const value = 1;\n")
        git(self.repo, "commit", "-qam", "older main")
        self.older = git(self.repo, "rev-parse", "HEAD")
        self.probe.write_text("export const value = 2;\n")
        git(self.repo, "commit", "-qam", "approved main")
        self.approved = git(self.repo, "rev-parse", "HEAD")
        git(self.repo, "push", "-qu", "origin", "main", "--tags")

    def run_go(self, repo=None):
        repo = repo or self.repo
        env = dict(os.environ, FORCE="1", SKIP_ACTIVITY_CHECK="1", DEPLOY_CALLS=str(self.calls))
        return subprocess.run(["/bin/bash", str(repo / "scripts/deploy-window.sh"), "go"],
                              cwd=repo, env=env, text=True, capture_output=True)

    def assert_rejected(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(self.calls.exists(), "unapproved source reached the deploy transport")
        self.assertEqual(git(self.repo, "rev-parse", "prod-deployed"), self.tag)
        self.assertEqual(git(self.repo, "ls-remote", "origin", "refs/tags/prod-deployed").split()[0], self.tag)

    def test_approved_detached_worktree_deploys(self):
        worktree = self.base / "pinned"
        git(self.repo, "worktree", "add", "--detach", str(worktree), self.approved)
        result = self.run_go(worktree)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.calls.read_text(), "functions\n")
        self.assertEqual(git(self.repo, "rev-parse", "prod-deployed"), self.approved)
        self.assertIn(str(worktree), result.stdout)
        self.assertIn(self.approved, result.stdout)

    def test_unmerged_branch_never_reaches_deploy(self):
        git(self.repo, "checkout", "-qb", "unapproved")
        self.probe.write_text("export const value = 3;\n")
        git(self.repo, "commit", "-qam", "unapproved")
        self.assert_rejected(self.run_go())

    def test_stale_main_never_rolls_production_back(self):
        git(self.repo, "checkout", "-q", "--detach", self.older)
        self.assert_rejected(self.run_go())

    def test_dirty_tracked_file_never_deploys(self):
        self.probe.write_text("export const value = 3;\n")
        self.assert_rejected(self.run_go())

    def test_untracked_file_never_deploys(self):
        (self.repo / "unfinished.txt").write_text("unfinished")
        self.assert_rejected(self.run_go())

    def test_unavailable_origin_is_unknown_not_approved(self):
        git(self.repo, "remote", "set-url", "origin", str(self.base / "absent.git"))
        result = self.run_go()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.calls.exists())
        self.assertEqual(git(self.repo, "rev-parse", "prod-deployed"), self.tag)

    def test_plan_remains_read_only_for_unpublished_work(self):
        git(self.repo, "checkout", "-qb", "unapproved")
        self.probe.write_text("export const value = 3;\n")
        git(self.repo, "commit", "-qam", "unapproved")
        (self.repo / "unfinished.txt").write_text("unfinished")
        git(self.repo, "remote", "set-url", "origin", str(self.base / "absent.git"))
        result = subprocess.run(["/bin/bash", str(self.repo / "scripts/deploy-window.sh"), "plan"],
                                cwd=self.repo, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse(self.calls.exists())
        self.assertEqual(git(self.repo, "rev-parse", "prod-deployed"), self.tag)

    def test_init_cannot_move_tag_to_an_unmerged_branch(self):
        git(self.repo, "checkout", "-qb", "unapproved")
        self.probe.write_text("export const value = 3;\n")
        git(self.repo, "commit", "-qam", "unapproved")
        result = subprocess.run(["/bin/bash", str(self.repo / "scripts/deploy-window.sh"), "init"],
                                cwd=self.repo, text=True, capture_output=True)
        self.assert_rejected(result)


if __name__ == "__main__":
    if sys.argv[1:] == ["porcha"]:
        source = SOURCE.read_text()
        broken = source.replace('[ "${1:-plan}" != "go" ] || published_source', ': # source guard removed')
        if broken == source:
            sys.exit("mutation target missing")
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "deploy-window.sh"
            target.write_text(broken)
            env = dict(os.environ, DEPLOY_SOURCE_SCRIPT=str(target))
            result = subprocess.run([sys.executable, __file__], env=env, capture_output=True, text=True)
            if result.returncode == 0 or "test_unmerged_branch_never_reaches_deploy" not in result.stderr:
                sys.exit("source guard removal was not detected")
            print("PASS: removing the source guard makes the real deploy regression fail")
    else:
        unittest.main()
