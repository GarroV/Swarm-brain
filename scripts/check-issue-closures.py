#!/usr/bin/env python3
"""Read-only audit of documented closing references in a new main commit range (#1079)."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

REPOSITORY = "GarroV/Swarm-brain"
# GitHub Docs: linking-a-pull-request-to-an-issue, closing keyword syntax table.
CLOSING = re.compile(
    r"(?<![\w])(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\b[ \t]*:?[ \t]+"
    r"(?:(?P<repo>[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+))?#(?P<number>[1-9][0-9]*)(?![\w])",
    re.IGNORECASE,
)
QUERY = """query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){issueOrPullRequest(number:$number){
    __typename ... on Issue { number state }
  }}
}"""


class CheckError(Exception):
    pass


def git(*args):
    result = subprocess.run(["git", *args], capture_output=True, timeout=15)
    if result.returncode:
        raise CheckError(f"cannot verify Git {args[0]}")
    return result.stdout.decode("utf-8", errors="replace").strip()


def references(message, repository):
    return {
        int(match["number"])
        for match in CLOSING.finditer(message)
        if match["repo"] is None or match["repo"].lower() == repository.lower()
    }


def range_references(base, head, repository):
    for ref in (base, head):
        if not re.fullmatch(r"[0-9a-fA-F]{40}", ref) or ref == "0" * 40:
            raise CheckError("before/after must be existing full commit SHAs")
        git("cat-file", "-e", f"{ref}^{{commit}}")
    git("merge-base", "--is-ancestor", base, head)
    commits = git("rev-list", f"{base}..{head}").splitlines()
    numbers = set()
    for commit in commits:
        numbers.update(references(git("show", "-s", "--format=%B", commit), repository))
    return numbers, len(commits)


def event_range(name, event, checkout):
    if event.get("repository", {}).get("full_name", "").lower() != REPOSITORY.lower():
        raise CheckError("event must belong to the own repository")
    if name == "push":
        if event.get("ref") != "refs/heads/main" or event.get("after", "").lower() != checkout:
            raise CheckError("push must target main at the checked-out after SHA")
        return event.get("before"), checkout
    if name == "workflow_run":
        run = event.get("workflow_run", {})
        if (run.get("name") != "Ночная раскатка" or run.get("status") != "completed"
                or run.get("head_branch") != "main"
                or run.get("head_repository", {}).get("full_name", "").lower() != REPOSITORY.lower()):
            raise CheckError("expected completed own main workflow Ночная раскатка")
        # Even a failed release can have merged commits before a later step failed.
        return run.get("head_sha"), checkout
    raise CheckError("only main push or completed night workflow events are supported")


def issue_state(repository, number):
    owner, name = repository.split("/")
    result = subprocess.run(
        ["gh", "api", "graphql", "-f", f"query={QUERY}", "-f", f"owner={owner}",
         "-f", f"name={name}", "-F", f"number={number}"],
        capture_output=True, text=True, timeout=10,
    )
    if result.returncode:
        raise CheckError(f"metadata lookup failed for #{number} (gh exit {result.returncode})")
    try:
        response = json.loads(result.stdout)
        if response.get("errors"):
            raise ValueError("GraphQL errors")
        item = response["data"]["repository"]["issueOrPullRequest"]
        if item["__typename"] == "PullRequest":
            return None
        if (item["__typename"] != "Issue" or type(item["number"]) is not int
                or item["number"] != number or item["state"] not in ("OPEN", "CLOSED")):
            raise ValueError("unexpected metadata")
        return item["state"]
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        raise CheckError(f"invalid or unavailable metadata for #{number}") from error


def verify(repository, numbers, attempts, interval):
    pending = set(numbers)
    for attempt in range(attempts):
        remaining = set()
        for number in sorted(pending):
            state = issue_state(repository, number)
            if state == "OPEN":
                remaining.add(number)
            elif state is None:
                print(f"issue-closures: skip PR #{number} (not an issue)")
        pending = remaining
        if not pending:
            return 0
        if attempt + 1 < attempts:
            time.sleep(interval)
    print("issue-closures: still OPEN after settling: " + ", ".join(f"#{n}" for n in sorted(pending)),
          file=sys.stderr)
    return 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base")
    parser.add_argument("--head")
    parser.add_argument("--event", type=Path)
    parser.add_argument("--event-name", default=os.environ.get("GITHUB_EVENT_NAME"))
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", REPOSITORY))
    parser.add_argument("--attempts", type=int, default=4)
    parser.add_argument("--interval", type=float, default=5)
    args = parser.parse_args()
    if args.repo.lower() != REPOSITORY.lower():
        raise CheckError(f"only {REPOSITORY} is supported; no foreign repository queries")
    if not 1 <= args.attempts <= 6 or not 0 <= args.interval <= 10:
        raise CheckError("attempts must be 1..6 and interval 0..10 seconds")
    if args.event:
        if args.base or args.head:
            raise CheckError("use either event payload or explicit before/after SHAs")
        base, head = event_range(args.event_name, json.loads(args.event.read_text()), git("rev-parse", "HEAD"))
    else:
        base, head = args.base, args.head
    numbers, commits = range_references(base, head, REPOSITORY)
    if not commits:
        print("issue-closures: PASS (no-op: no new commits)")
        return 0
    if not numbers:
        print(f"issue-closures: PASS ({commits} new commits; no documented own-issue closing references)")
        return 0
    result = verify(REPOSITORY, numbers, args.attempts, args.interval)
    if result == 0:
        print(f"issue-closures: PASS ({commits} new commits; {len(numbers)} unique own references checked)")
    return result


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (CheckError, OSError, ValueError, TypeError, AttributeError, subprocess.TimeoutExpired) as error:
        detail = "command timed out" if isinstance(error, subprocess.TimeoutExpired) else str(error)
        print(f"issue-closures: cannot verify: {detail}", file=sys.stderr)
        sys.exit(2)
