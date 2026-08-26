#!/usr/bin/env python3
"""Validate a private ordered book-package manifest without reading the source text."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from build_book_package_manifest import BookPackageError, validate_book_package_manifest


def read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise BookPackageError(f"Book package manifest does not exist: {path}") from exc
    except UnicodeDecodeError as exc:
        raise BookPackageError(f"Book package manifest is not UTF-8: {path}") from exc
    except json.JSONDecodeError as exc:
        raise BookPackageError(
            f"Book package manifest is invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}"
        ) from exc


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--json", action="store_true", help="Emit a machine-readable report.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validation = validate_book_package_manifest(read_json(args.manifest))
    except BookPackageError as exc:
        print(f"Book package validation error: {exc}", file=sys.stderr)
        return 1
    payload = {"manifest": str(args.manifest), **validation.payload()}
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for issue in payload["issues"]:
            location = f" [{issue['location']}]" if issue.get("location") else ""
            print(f"{issue['severity'].upper()} {issue['code']}{location}: {issue['message']}")
        print(f"Book package validation: {payload['errorCount']} error(s), {payload['warningCount']} warning(s).")
    return 0 if validation.valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
