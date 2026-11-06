#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Execute the workflow's real chain step against fake git/gh; never dispatch a workflow."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = Path(os.environ.get("DEPLOY_CHAIN_WORKFLOW", ROOT / ".github/workflows/deploy-window.yml"))
TITLE = "      - name: Следующий PR — следующим прогоном"


def chain_step(source):
    lines = source.splitlines()
    start = lines.index(TITLE) + 1
    end = next((i for i in range(start, len(lines)) if lines[i].startswith("      - ")), len(lines))
    block = lines[start:end]
    run = block.index("        run: |")
    script = "\n".join(line[10:] for line in block[run + 1:])
    env = {}
    for line in block[:run]:
        match = re.fullmatch(r"          ([A-Z_]+): (.+)", line)
        if match:
            env[match[1]] = match[2]
    return script, env


def execute(source, force=None, after="after", left=2, dispatch_status=0):
    script, bindings = chain_step(source)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        git = tmp / "git"
        git.write_text(f"#!{sys.executable}\n" + '''import os,sys
assert sys.argv[1:] == ["ls-remote", "origin", "refs/heads/main"]
print(os.environ["FAKE_AFTER"]+"\\trefs/heads/main")
''')
        gh = tmp / "gh"
        gh.write_text(f"#!{sys.executable}\n" + '''import json,os,sys
args=sys.argv[1:]
assert args[args.index("--repo")+1] == "fixture/repo"
if args[:2] == ["pr", "list"]:
 print(os.environ["FAKE_LEFT"])
elif args[:2] == ["workflow", "run"]:
 with open(os.environ["FAKE_CALLS"], "a") as f: f.write(json.dumps(args)+"\\n")
 sys.exit(int(os.environ["FAKE_DISPATCH_STATUS"]))
else: raise AssertionError(args)
''')
        git.chmod(0o755)
        gh.chmod(0o755)
        calls = tmp / "calls.jsonl"
        env = dict(PATH=str(tmp) + os.pathsep + os.defpath, REPO="fixture/repo", BEFORE="before",
                   GH_TOKEN="fixture", FAKE_AFTER=after, FAKE_LEFT=str(left), FAKE_CALLS=str(calls),
                   FAKE_DISPATCH_STATUS=str(dispatch_status))
        for name, value in bindings.items():
            match = re.fullmatch(r"\$\{\{\s*inputs.force\s*&&\s*'([^']*)'\s*\|\|\s*'([^']*)'\s*\}\}", value)
            if match:
                env[name] = match[1] if force else match[2]
        result = subprocess.run(["/bin/bash", "--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script],
                                env=env, text=True, capture_output=True, stdin=subprocess.DEVNULL)
        dispatched = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
        return result.returncode, dispatched


class ChainTests(unittest.TestCase):
    def setUp(self):
        self.source = WORKFLOW.read_text()

    def test_explicit_force_survives_three_hops(self):
        force = True
        for _ in range(3):
            status, calls = execute(self.source, force)
            self.assertEqual(status, 0)
            self.assertEqual(len(calls), 1)
            self.assertIn("dry_run=false", calls[0])
            self.assertIn("force=true", calls[0])
            force = "force=true" in calls[0]

    def test_manual_false_stays_false(self):
        status, calls = execute(self.source, False)
        self.assertEqual(status, 0)
        self.assertIn("force=false", calls[0])

    def test_schedule_without_input_stays_false(self):
        status, calls = execute(self.source)
        self.assertEqual(status, 0)
        self.assertIn("force=false", calls[0])

    def test_no_merge_stops_chain(self):
        self.assertEqual(execute(self.source, True, after="before"), (0, []))

    def test_empty_queue_stops_chain(self):
        self.assertEqual(execute(self.source, True, left=0), (0, []))

    def test_dispatch_failure_is_not_green(self):
        status, calls = execute(self.source, True, dispatch_status=13)
        self.assertEqual(status, 13)
        self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    if sys.argv[1:] == ["porcha"]:
        source = WORKFLOW.read_text()
        broken = source.replace('-f force="$FORCE"', '-f force=false')
        if broken == source:
            sys.exit("mutation target missing")
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "workflow.yml"
            target.write_text(broken)
            env = dict(os.environ, DEPLOY_CHAIN_WORKFLOW=str(target))
            result = subprocess.run([sys.executable, __file__], env=env, capture_output=True, text=True)
            if result.returncode == 0 or "test_explicit_force_survives_three_hops" not in result.stderr:
                sys.exit("force loss was not detected")
            print("PASS: restoring force=false makes the real three-hop regression fail")
    else:
        unittest.main()
