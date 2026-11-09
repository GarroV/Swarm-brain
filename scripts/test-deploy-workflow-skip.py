#!/usr/bin/env python3
"""Nightly merge: a PR that edits .github/workflows/ is skipped with a reason (#856), and a failed
post-merge functions deploy tells the PR what to do next (#192). Local git remote, fake gh."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get("DEPLOY_SKIP_SCRIPT", ROOT / "scripts/deploy-window-merge.sh"))


class WorkflowSkipTests(unittest.TestCase):
    def git(self, *args):
        return subprocess.check_output(["git", "-C", str(self.repo), *args], text=True,
                                       stderr=subprocess.PIPE).strip()

    def make_pr(self, num, path):
        self.git("checkout", "-q", "-b", f"pr{num}", "main")
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f"change {num}\n")
        self.git("add", ".")
        self.git("commit", "-qm", f"pr {num}")
        self.git("push", "-q", "origin", f"pr{num}:refs/pull/{num}/head")
        self.git("checkout", "-q", "main")

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
[ "$1" != go ] || [ "${FAIL_GO:-0}" != 1 ] || exit 1
if [ "$1" = go ]; then
  git tag -f prod-deployed HEAD >/dev/null
  git push -q -f origin refs/tags/prod-deployed
fi
''')
        deploy.chmod(0o755)
        (self.repo / "supabase/functions/probe").mkdir(parents=True)
        (self.repo / "supabase/functions/probe/index.ts").write_text("export const n = 0;\n")
        self.git("add", ".")
        self.git("commit", "-qm", "base")
        self.git("tag", "prod-deployed")
        self.git("push", "-qu", "origin", "main", "--tags")
        self.make_pr(1, ".github/workflows/x.yml")
        self.make_pr(2, "docs/note.md")
        self.bin = self.base / "bin"
        self.bin.mkdir()
        prs = json.dumps([{"number": n, "title": f"pr{n}", "mergeable": "MERGEABLE",
                           "mergeStateStatus": "CLEAN", "createdAt": f"2026-11-0{n}T00:00:00Z"} for n in (1, 2)])
        gh = self.bin / "gh"
        gh.write_text(f"#!{sys.executable}\n" + '''import os,sys
a=sys.argv[1:]
log=open(os.environ["TRACE"],"a")
if a[:2]==["pr","list"]: print(%r)
elif a[:2]==["pr","view"]: print("")
elif a[:2]==["pr","comment"]: log.write("comment %%s: %%s\\n"%%(a[2],a[a.index("--body")+1].replace("\\n"," ")))
elif a[:2]==["pr","merge"]: log.write("merge %%s\\n"%%a[2])
elif a[:2]==["pr","edit"]: log.write("edit %%s\\n"%%a[2])
elif a[0]=="api": print("abc1234")
''' % prs)
        date = self.bin / "date"
        date.write_text(f"#!{sys.executable}\n" + '''import os,sys
print("23" if sys.argv[-1]=="+%H" else "Fri 23:05 CET")
''')
        gh.chmod(0o755)
        date.chmod(0o755)
        self.trace = self.base / "trace"

    def run_script(self, **extra):
        env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"], REPO="fixture/repo",
                   TRACE=str(self.trace), FORCE="0", DRY_RUN="0", **extra)
        env.pop("SKIP_ACTIVITY_CHECK", None)
        result = subprocess.run(["/bin/bash", "scripts/deploy-window-merge.sh"], cwd=self.repo,
                                env=env, capture_output=True, text=True)
        trace = self.trace.read_text().splitlines() if self.trace.exists() else []
        return result, trace

    def test_workflow_pr_is_skipped_with_reason_and_next_pr_is_merged(self):
        result, trace = self.run_script()
        out = result.stdout + result.stderr
        self.assertEqual(result.returncode, 0, out)
        self.assertIn("Пропускаю #1", out)
        self.assertTrue(any(l.startswith("comment 1:") and ".github/workflows/x.yml" in l
                            and "руками" in l for l in trace), trace)
        self.assertIn("merge 2", trace)
        self.assertNotIn("merge 1", trace)

    def test_workflow_pr_alone_is_never_merged(self):
        self.git("push", "-q", "origin", "--delete", "refs/pull/2/head")
        result, trace = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse([l for l in trace if l.startswith("merge")], trace)

    def test_failed_functions_deploy_tells_the_pr_what_happens_next(self):
        result, trace = self.run_script(FAIL_GO="1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("следующий ночной прогон", result.stdout)
        done = [l for l in trace if l.startswith("comment 2:")]
        self.assertTrue(done and "НЕ раскатаны" in done[0] and "следующий ночной прогон" in done[0], trace)


if __name__ == "__main__":
    if sys.argv[1:] == ["porcha"]:
        source = SOURCE.read_text()
        mutations = [
            ('elif [ -n "$WF_FILES" ]; then', 'elif false; then',
             "test_workflow_pr_is_skipped_with_reason_and_next_pr_is_merged"),
            ('[ "$FUNCS_RESULT" = "раскатаны" ] || FUNCS_NOTE=', '[ "$FUNCS_RESULT" = "раскатаны" ] || FUNCS_NOTE_OFF=',
             "test_failed_functions_deploy_tells_the_pr_what_happens_next"),
        ]
        for old, new, test in mutations:
            broken = source.replace(old, new)
            if broken == source:
                sys.exit("mutation target missing")
            with tempfile.TemporaryDirectory() as tmp:
                target = Path(tmp) / "deploy-window-merge.sh"
                target.write_text(broken)
                env = dict(os.environ, DEPLOY_SKIP_SCRIPT=str(target))
                result = subprocess.run([sys.executable, __file__], env=env, capture_output=True, text=True)
                if result.returncode == 0 or test not in result.stderr:
                    sys.exit("regression was not detected: " + test)
                print("PASS: mutation detected by " + test)
    else:
        unittest.main()
