#!/usr/bin/env python3
"""Run the nightly entry point with a local git remote and fake GitHub/deploy commands."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get("DEPLOY_CATCHUP_SCRIPT", ROOT / "scripts/deploy-window-merge.sh"))


class CatchupTests(unittest.TestCase):
    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], text=True,
                                       stderr=subprocess.PIPE).strip()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name).resolve()
        self.repo = self.base / "repo"
        self.repo.mkdir()
        remote = self.base / "origin.git"
        subprocess.run(["git", "init", "-q", "--bare", "--initial-branch=main", str(remote)], check=True)
        self.git("init", "-q", "--initial-branch=main")
        for key, value in [("user.name", "Fixture"), ("user.email", "fixture@example.invalid"),
                           ("core.hooksPath", "/dev/null")]:
            self.git("config", key, value)
        self.git("remote", "add", "origin", str(remote))
        scripts = self.repo / "scripts"
        (scripts / "lib").mkdir(parents=True)
        shutil.copyfile(SOURCE, scripts / "deploy-window-merge.sh")
        shutil.copyfile(ROOT / "scripts/lib/migrations-gate.sh", scripts / "lib/migrations-gate.sh")
        (scripts / "lib/swarm-server.sh").write_text("swarm_server() { return 99; }\n")
        deploy = scripts / "deploy-window.sh"
        deploy.write_text('''#!/bin/bash
set -eu
printf '%s\\n' "$1" >> "$TRACE"
if [ "$1" = plan ]; then [ "${FAIL_PLAN:-0}" != 1 ] || exit 1; fi
if [ "$1" = go ]; then
  [ "${FAIL_GO:-0}" != 1 ] || exit 1
  git tag -f prod-deployed HEAD >/dev/null
  git push -q -f origin refs/tags/prod-deployed
fi
''')
        deploy.chmod(0o755)
        probe = self.repo / "supabase/functions/probe/index.ts"
        probe.parent.mkdir(parents=True)
        probe.write_text("export const n = 0;\n")
        self.git("add", ".")
        self.git("commit", "-qm", "base")
        self.git("tag", "prod-deployed")
        self.old_tag = self.git("rev-parse", "prod-deployed")
        probe.write_text("export const n = 1;\n")
        self.git("commit", "-qam", "pending functions")
        self.git("push", "-qu", "origin", "main", "--tags")
        self.bin = self.base / "bin"
        self.bin.mkdir()
        gh = self.bin / "gh"
        gh.write_text(f"#!{sys.executable}\n" + '''import os,sys
assert sys.argv[1:3]==["pr","list"],sys.argv
assert sys.argv[sys.argv.index("--repo")+1]=="fixture/repo"
with open(os.environ["TRACE"],"a") as f:f.write("pr-list\\n")
print("[]")
''')
        date = self.bin / "date"
        date.write_text(f"#!{sys.executable}\n" + '''import os,sys
print(os.environ["FAKE_HOUR"] if sys.argv[-1]=="+%H" else "Fri 23:05 CET")
''')
        gh.chmod(0o755)
        date.chmod(0o755)
        self.trace = self.base / "trace"

    def run_script(self, hour="23", force="0", dry="0", fail="0", fail_plan="0"):
        env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"], REPO="fixture/repo",
                   TRACE=str(self.trace), FAKE_HOUR=hour, FORCE=force, DRY_RUN=dry, FAIL_GO=fail,
                   FAIL_PLAN=fail_plan)
        env.pop("SKIP_ACTIVITY_CHECK", None)
        result = subprocess.run(["/bin/bash", "scripts/deploy-window-merge.sh"], cwd=self.repo,
                                env=env, capture_output=True, text=True)
        trace = self.trace.read_text().splitlines() if self.trace.exists() else []
        return result, trace

    def test_night_recovers_without_an_open_pr(self):
        result, trace = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(trace, ["go", "pr-list"])
        self.assertEqual(self.git("rev-parse", "prod-deployed"), self.git("rev-parse", "HEAD"))

    def test_failed_recovery_blocks_new_pr_selection_and_preserves_pending_tag(self):
        result, trace = self.run_script(fail="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(trace, ["go"])
        self.assertEqual(self.git("rev-parse", "prod-deployed"), self.old_tag)

    def test_no_function_drift_does_not_deploy(self):
        self.git("tag", "-f", "prod-deployed", "HEAD")
        self.git("push", "-q", "-f", "origin", "refs/tags/prod-deployed")
        result, trace = self.run_script()
        self.assertEqual(result.returncode, 0)
        self.assertEqual(trace, ["pr-list"])

    def test_day_force_does_not_bypass_manual_activity_check_via_catchup(self):
        result, trace = self.run_script(hour="12", force="1")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(trace, ["pr-list"])
        self.assertEqual(self.git("rev-parse", "prod-deployed"), self.old_tag)

    def test_day_without_force_stops_before_github(self):
        result, trace = self.run_script(hour="12")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(trace, [])

    def test_dry_run_only_plans_and_preserves_wip(self):
        self.git("checkout", "-qb", "work-in-progress")
        dirty = self.repo / "unfinished.txt"
        dirty.write_text("preserve")
        head = self.git("rev-parse", "HEAD")
        result, trace = self.run_script(dry="1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(trace, ["plan", "pr-list"])
        self.assertEqual(self.git("rev-parse", "HEAD"), head)
        self.assertEqual(self.git("branch", "--show-current"), "work-in-progress")
        self.assertEqual(dirty.read_text(), "preserve")
        self.assertEqual(self.git("rev-parse", "prod-deployed"), self.old_tag)

    def test_unknown_origin_does_not_choose_another_pr(self):
        self.git("remote", "set-url", "origin", str(self.base / "missing.git"))
        result, trace = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(trace, [])

    def test_failed_dry_plan_is_not_a_green_catchup(self):
        result, trace = self.run_script(dry="1", fail_plan="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(trace, ["plan"])
        self.assertEqual(self.git("rev-parse", "prod-deployed"), self.old_tag)

    def test_dirty_work_is_preserved_and_no_pr_is_chosen(self):
        dirty = self.repo / "unfinished.txt"
        dirty.write_text("preserve")
        result, trace = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(trace, [])
        self.assertEqual(dirty.read_text(), "preserve")
        self.assertEqual(self.git("rev-parse", "prod-deployed"), self.old_tag)


if __name__ == "__main__":
    if sys.argv[1:] == ["porcha"]:
        source = SOURCE.read_text()
        mutations = [
            ('if [ "$drift" = 1 ]; then', 'if false; then', "test_night_recovers_without_an_open_pr"),
            ('if [ "$FUNCS_RESULT" != "раскатаны" ]; then', 'if false; then',
             "test_failed_recovery_blocks_new_pr_selection_and_preserves_pending_tag"),
        ]
        for old, new, test in mutations:
            broken = source.replace(old, new)
            if broken == source:
                sys.exit("mutation target missing")
            with tempfile.TemporaryDirectory() as tmp:
                target = Path(tmp) / "deploy-window-merge.sh"
                target.write_text(broken)
                env = dict(os.environ, DEPLOY_CATCHUP_SCRIPT=str(target))
                result = subprocess.run([sys.executable, __file__], env=env, capture_output=True, text=True)
                if result.returncode == 0 or test not in result.stderr:
                    sys.exit("catchup regression was not detected: " + test)
                print("PASS: mutation detected by " + test)
    else:
        unittest.main()
