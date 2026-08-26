#!/usr/bin/env python3
"""Validate a private book-agent draft and, optionally, its owning job."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from poet_map_job import job_root_for_manifest, load_job, read_json, validate_job_manifest
from run_book_analysis_agent import draft_validation


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--draft", type=Path, required=True)
    parser.add_argument("--job", type=Path)
    parser.add_argument("--json", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    draft = read_json(args.draft, "Book-agent draft")
    report = draft_validation(draft)
    output = {"draft": str(args.draft), "draftValidation": report}
    valid = bool(report.get("valid"))
    if args.job:
        job = load_job(args.job)
        root = job_root_for_manifest(args.job, job)
        job_report = validate_job_manifest(job, artifact_root=root)
        output["jobValidation"] = job_report.payload()
        valid = valid and job_report.valid
    if args.json:
        print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        print(f"Book-agent draft validation: {'valid' if valid else 'invalid'}")
        for issue in report.get("issues", []):
            print(f"{issue['severity'].upper()} {issue['code']} [{issue['path']}]: {issue['message']}")
    return 0 if valid else 1


if __name__ == "__main__":
    raise SystemExit(main())

