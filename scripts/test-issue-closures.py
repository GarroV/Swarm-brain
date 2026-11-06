#!/usr/bin/env python3
"""Real Git histories plus a metadata-only fake gh; no GitHub writes or network."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

GATE = Path(os.environ.get("CLOSURE_GATE_UNDER_TEST", Path(__file__).with_name("check-issue-closures.py"))).resolve()
FAKE_GH = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args=sys.argv[1:]
assert args[:2]==["api","graphql"], args
fields={args[i+1].split("=",1)[0]:args[i+1].split("=",1)[1] for i in range(2,len(args),2)}
assert fields["owner"]=="GarroV" and fields["name"]=="Swarm-brain"
query=fields["query"]
assert query.lstrip().startswith("query(") and "mutation" not in query
assert "title" not in query and "body" not in query
number=fields["number"]
calls=Path(os.environ["CLOSURE_CALLS_FILE"])
history=json.loads(calls.read_text()) if calls.exists() else []
attempt=history.count(number)
history.append(number); calls.write_text(json.dumps(history))
values=json.loads(Path(os.environ["CLOSURE_FIXTURE_FILE"]).read_text())
state=values[number]; state=state[min(attempt,len(state)-1)] if isinstance(state,list) else state
if state=="API_ERROR": sys.exit(7)
if state=="BAD_JSON": print("not JSON"); sys.exit(0)
if state=="GRAPHQL_ERRORS": print(json.dumps({"errors":[{"message":"fixture failure"}]})); sys.exit(0)
item=None if state=="MISSING" else {"__typename":"PullRequest"} if state=="PR" else {"__typename":"Issue","number":int(number),"state":state}
if state=="WRONG_NUMBER": item.update(number=int(number)+1,state="CLOSED")
print(json.dumps({"data":{"repository":{"issueOrPullRequest":item}}}))
'''


class ClosureTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="swarm-closure-test-")
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.bin = self.root / "bin"
        self.bin.mkdir()
        gh = self.bin / "gh"
        gh.write_text(FAKE_GH)
        gh.chmod(0o755)
        self.data = self.root / "states.json"
        self.calls = self.root / "calls.json"
        self.base = self.commit("initial")

    def git(self, *args):
        return subprocess.check_output(["git", "-c", "core.hooksPath=/dev/null", *args],
                                       cwd=self.root, stderr=subprocess.STDOUT).decode().strip()

    def commit(self, message):
        message_file = self.root / "message"
        message_file.write_text(message)
        self.git("commit", "-q", "--allow-empty", "-F", str(message_file))
        return self.git("rev-parse", "HEAD")

    def check(self, status, states=None, base=None, head=None, *extra):
        self.data.write_text(json.dumps(states or {}))
        env = {**os.environ, "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
               "CLOSURE_FIXTURE_FILE": str(self.data), "CLOSURE_CALLS_FILE": str(self.calls)}
        refs = [] if "--event" in extra else ["--base", base or self.base, "--head", head or self.git("rev-parse", "HEAD")]
        result = subprocess.run(
            [sys.executable, str(GATE), "--repo", "GarroV/Swarm-brain", *refs,
             "--attempts", "1", "--interval", "0", *extra],
            cwd=self.root, env=env, capture_output=True, text=True, timeout=20,
        )
        self.assertEqual(result.returncode, status, result.stdout + result.stderr)
        return result.stdout + result.stderr

    def requested(self):
        return json.loads(self.calls.read_text()) if self.calls.exists() else []

    def test_open_issue_fails(self):
        self.commit("fix: regression\n\nCloses #1")
        self.assertIn("still OPEN", self.check(1, {"1": "OPEN"}))

    def test_closed_issue_passes(self):
        self.commit("Fixes #1")
        self.check(0, {"1": "CLOSED"})

    def test_all_documented_keywords_case_colon_and_qualified_own_repo(self):
        keywords = ("close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved")
        self.commit("\n".join(f"{word.upper()}: garrov/SWARM-brain#{n}" for n, word in enumerate(keywords, 1)))
        self.check(0, {str(n): "CLOSED" for n in range(1, 10)})
        self.assertEqual(set(self.requested()), {str(n) for n in range(1, 10)})

    def test_keyword_required_for_each_ref_foreign_and_unrelated_text_ignored(self):
        self.commit("Closes #1, #2; FIXES GarroV/Swarm-brain#3\nResolves other/repo#4\nRefs #5; discloses #6; fixing #7")
        self.check(0, {"1": "CLOSED", "3": "CLOSED"})
        self.assertEqual(self.requested(), ["1", "3"])

    def test_range_includes_earlier_commit_not_just_tip(self):
        self.commit("Closes #1")
        self.commit("later change without closing references")
        self.assertIn("still OPEN", self.check(1, {"1": "OPEN"}))

    def test_merged_side_branch_is_in_range(self):
        self.git("checkout", "-qb", "topic")
        self.commit("Fixed #1")
        self.git("checkout", "-q", "main")
        self.commit("main change")
        self.git("merge", "--no-ff", "-qm", "merge topic", "topic")
        self.check(1, {"1": "OPEN"})

    def test_older_references_outside_push_are_not_queried(self):
        base = self.commit("Closes #9")
        self.commit("Closes #1")
        self.check(0, {"1": "CLOSED"}, base=base)
        self.assertEqual(self.requested(), ["1"])

    def test_refs_deduplicated_across_commits_and_spellings(self):
        self.commit("Closes #1; Fixed GarroV/Swarm-brain#1")
        self.commit("Resolves #1")
        self.check(0, {"1": "CLOSED"})
        self.assertEqual(self.requested(), ["1"])

    def test_settling_open_then_closed(self):
        self.commit("Closes #1")
        self.check(0, {"1": ["OPEN", "CLOSED"]}, None, None, "--attempts", "2")
        self.assertEqual(self.requested(), ["1", "1"])

    def test_settling_is_bounded(self):
        self.commit("Closes #1")
        self.check(1, {"1": "OPEN"}, None, None, "--attempts", "3")
        self.assertEqual(self.requested(), ["1", "1", "1"])

    def test_pull_request_reference_is_not_an_issue(self):
        self.commit("Closes #1")
        self.assertIn("skip PR", self.check(0, {"1": "PR"}))

    def test_api_errors_missing_and_malformed_metadata_fail_closed(self):
        for state in ("API_ERROR", "BAD_JSON", "GRAPHQL_ERRORS", "MISSING", "UNKNOWN", "WRONG_NUMBER"):
            with self.subTest(state=state):
                head = self.commit("Closes #1")
                self.assertIn("cannot verify", self.check(2, {"1": state}, head=head))

    def test_no_refs_does_not_query_github(self):
        self.commit("ordinary commit, Refs #1")
        self.check(0)
        self.assertEqual(self.requested(), [])

    def test_invalid_range_and_foreign_repository_fail_before_network(self):
        self.commit("Closes #1")
        self.check(2, base="0" * 40)
        self.check(2, base="f" * 40)
        self.check(2, None, None, None, "--repo", "other/repo")
        self.assertEqual(self.requested(), [])

    def test_empty_range_and_non_ancestor_history(self):
        self.check(0)
        self.git("checkout", "-qb", "topic")
        before = self.commit("topic")
        self.git("checkout", "-q", "main")
        head = self.commit("Closes #1")
        self.check(2, base=before, head=head)
        self.assertEqual(self.requested(), [])

    def event(self, name, payload, status, states=None):
        event = self.root / "event.json"
        event.write_text(json.dumps({"repository": {"full_name": "GarroV/Swarm-brain"}, **payload}))
        return self.check(status, states, None, None, "--event", str(event), "--event-name", name)

    def night(self, **changes):
        return {"name": "Ночная раскатка", "status": "completed", "head_branch": "main",
                "head_sha": self.base, "head_repository": {"full_name": "GarroV/Swarm-brain"}, **changes}

    def test_push_event_uses_before_through_pinned_checkout(self):
        self.commit("Closes #1")
        self.commit("later main commit")
        self.event("push", {"ref": "refs/heads/main", "before": self.base,
                            "after": self.git("rev-parse", "HEAD")}, 1, {"1": "OPEN"})

    def test_push_mismatched_checkout_or_wrong_branch_fails_closed(self):
        self.commit("Closes #1")
        self.event("push", {"ref": "refs/heads/main", "before": self.base, "after": self.base}, 2)
        self.event("push", {"ref": "refs/heads/topic", "before": self.base,
                            "after": self.git("rev-parse", "HEAD")}, 2)
        self.assertEqual(self.requested(), [])

    def test_night_workflow_completed_failure_still_checks_merged_refs(self):
        self.commit("Closes #1")
        self.commit("release failed later")
        self.event("workflow_run", {"workflow_run": self.night(conclusion="failure")}, 1, {"1": "OPEN"})

    def test_night_workflow_success_no_changes_is_explicit_noop(self):
        output = self.event("workflow_run", {"workflow_run": self.night(conclusion="success")}, 0)
        self.assertIn("no-op", output)
        self.assertEqual(self.requested(), [])

    def test_wrong_workflow_foreign_repo_branch_and_incomplete_run_rejected(self):
        self.commit("Closes #1")
        for change in ({"name": "Other"}, {"head_branch": "topic"}, {"status": "in_progress"},
                       {"head_repository": {"full_name": "other/repo"}}, {"head_sha": "f" * 40}):
            with self.subTest(change=change):
                self.event("workflow_run", {"workflow_run": self.night(**change)}, 2)
        self.event("push", {"repository": {"full_name": "other/repo"}}, 2)
        self.assertEqual(self.requested(), [])


def porcha():
    source = GATE.read_text()
    mutants = (
        ('if state == "OPEN":', 'if False:', "test_open_issue_fails"),
        ('commits = git("rev-list", f"{base}..{head}").splitlines()',
         'commits = [head]', "test_range_includes_earlier_commit_not_just_tip"),
        ('return run.get("head_sha"), checkout', 'return checkout, checkout',
         "test_night_workflow_completed_failure_still_checks_merged_refs"),
        ('run.get("name") != "Ночная раскатка"', 'False',
         "test_wrong_workflow_foreign_repo_branch_and_incomplete_run_rejected"),
    )
    for old, new, expected in mutants:
        assert source.count(old) == 1
        with tempfile.TemporaryDirectory(prefix="swarm-closure-mutant-") as directory:
            mutant = Path(directory) / "gate.py"
            mutant.write_text(source.replace(old, new))
            result = subprocess.run([sys.executable, str(Path(__file__).resolve())], capture_output=True, text=True,
                                    env={**os.environ, "CLOSURE_GATE_UNDER_TEST": str(mutant)})
            assert result.returncode != 0 and f"FAIL: {expected}" in result.stderr, result.stderr
            print(f"porcha: caught {expected}")


if __name__ == "__main__":
    if sys.argv[1:] == ["porcha"]:
        porcha()
    else:
        unittest.main()
