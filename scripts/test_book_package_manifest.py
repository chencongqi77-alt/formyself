"""Focused tests for the private ordered book-package manifest component."""

from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from build_book_package_manifest import (  # noqa: E402
    BookPackageError,
    build_book_package_manifest,
    package_sha256,
    validate_book_package_manifest,
    write_book_package_manifest,
)


class BookPackageManifestTest(unittest.TestCase):
    def make_workspace(self) -> tuple[tempfile.TemporaryDirectory[str], Path, Path, Path]:
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        job_root = root / "jobs"
        job_directory = job_root / "bmj-book-fixture"
        job_directory.mkdir(parents=True)
        job_path = job_directory / "job.json"
        job_path.write_text(
            json.dumps({"jobId": "bmj-book-fixture", "input": {"kind": "ordered-package-pending"}}) + "\n",
            encoding="utf-8",
        )
        input_root = root / "input"
        input_root.mkdir()
        return temporary, job_root, job_path, input_root

    def build(self, input_root: Path) -> dict:
        return build_book_package_manifest(
            input_root=input_root,
            job_id="bmj-book-fixture",
            book_id="dongpo-quanji",
            book_title="东坡全集",
            source_id="kanripo-kr4d0076",
            created_at="2026-08-24T00:00:00Z",
        )

    def test_manifest_uses_posix_lexicographic_order_and_explicit_hints(self) -> None:
        temporary, _job_root, _job_path, input_root = self.make_workspace()
        with temporary:
            (input_root / "parts").mkdir()
            (input_root / "parts" / "02.txt").write_text("# 第二节\n正文秘文二\n", encoding="utf-8")
            (input_root / "parts" / "10.txt").write_text("正文秘文十\n", encoding="utf-8")
            (input_root / "parts" / "2.txt").write_text("#+PROPERTY: JUAN 本传\n正文秘文\n", encoding="utf-8")
            (input_root / "Readme.org").write_text("目录页\n", encoding="utf-8")

            manifest = self.build(input_root)

            self.assertTrue(validate_book_package_manifest(manifest).valid)
            self.assertEqual(
                ["parts/02.txt", "parts/10.txt", "parts/2.txt"],
                [member["relativePath"] for member in manifest["members"]],
            )
            self.assertEqual(1, manifest["selection"]["excludedFileCount"])
            hints = manifest["members"][0]["sectionHints"] + manifest["members"][2]["sectionHints"]
            self.assertIn(
                {"kind": "heading", "title": "第二节", "line": 1, "detector": "markdown-heading-v1"},
                hints,
            )
            self.assertIn(
                {"kind": "juan", "title": "本传", "line": 1, "detector": "kanripo-org-juan-v1"},
                hints,
            )
            serialized = json.dumps(manifest, ensure_ascii=False)
            self.assertNotIn("正文秘文", serialized)
            self.assertNotIn(str(input_root), serialized)

    def test_package_digest_includes_member_order(self) -> None:
        temporary, _job_root, _job_path, input_root = self.make_workspace()
        with temporary:
            (input_root / "a.txt").write_text("甲\n", encoding="utf-8")
            (input_root / "b.txt").write_text("乙\n", encoding="utf-8")
            manifest = self.build(input_root)
            members = manifest["members"]
            reordered = copy.deepcopy(list(reversed(members)))
            for ordinal, member in enumerate(reordered, start=1):
                member["ordinal"] = ordinal
            self.assertNotEqual(manifest["packageSha256"], package_sha256(reordered))

    def test_non_utf8_member_is_hashed_but_not_guessed_as_a_heading(self) -> None:
        temporary, _job_root, _job_path, input_root = self.make_workspace()
        with temporary:
            (input_root / "legacy.txt").write_bytes(b"\xff\xfe\x00\x01")
            manifest = self.build(input_root)
            self.assertEqual([], manifest["members"][0]["sectionHints"])
            self.assertTrue(validate_book_package_manifest(manifest).valid)

    def test_fixed_job_output_refuses_overwrite_and_dry_run_does_not_write(self) -> None:
        temporary, job_root, job_path, input_root = self.make_workspace()
        with temporary:
            (input_root / "body.txt").write_text("正文\n", encoding="utf-8")
            target, dry_run = write_book_package_manifest(
                job_path=job_path,
                job_root=job_root,
                input_root=input_root,
                book_id="dongpo-quanji",
                book_title="东坡全集",
                source_id="kanripo-kr4d0076",
                dry_run=True,
            )
            self.assertFalse(target.exists())
            self.assertEqual("book-package-manifest", dry_run["recordType"])

            target, _manifest = write_book_package_manifest(
                job_path=job_path,
                job_root=job_root,
                input_root=input_root,
                book_id="dongpo-quanji",
                book_title="东坡全集",
                source_id="kanripo-kr4d0076",
            )
            original = target.read_text(encoding="utf-8")
            with self.assertRaisesRegex(BookPackageError, "refusing to overwrite"):
                write_book_package_manifest(
                    job_path=job_path,
                    job_root=job_root,
                    input_root=input_root,
                    book_id="dongpo-quanji",
                    book_title="东坡全集",
                    source_id="kanripo-kr4d0076",
                )
            self.assertEqual(original, target.read_text(encoding="utf-8"))

    def test_empty_source_and_outside_job_anchor_are_rejected(self) -> None:
        temporary, job_root, job_path, input_root = self.make_workspace()
        with temporary:
            with self.assertRaisesRegex(BookPackageError, "no source members"):
                self.build(input_root)
            outside_job = input_root / "job.json"
            outside_job.write_text(
                json.dumps({"jobId": "bmj-book-fixture", "input": {"kind": "ordered-package-pending"}}),
                encoding="utf-8",
            )
            (input_root / "body.txt").write_text("正文\n", encoding="utf-8")
            with self.assertRaisesRegex(BookPackageError, "below the configured job root"):
                write_book_package_manifest(
                    job_path=outside_job,
                    job_root=job_root,
                    input_root=input_root,
                    book_id="dongpo-quanji",
                    book_title="东坡全集",
                    source_id="kanripo-kr4d0076",
                )

    def test_current_single_blob_job_shape_cannot_receive_a_directory_package(self) -> None:
        temporary, job_root, job_path, input_root = self.make_workspace()
        with temporary:
            job_path.write_text(
                json.dumps(
                    {
                        "jobId": "bmj-book-fixture",
                        "input": {"sourceId": "single-upload", "blobSha256": "a" * 64},
                    }
                ),
                encoding="utf-8",
            )
            (input_root / "body.txt").write_text("正文\n", encoding="utf-8")
            with self.assertRaisesRegex(BookPackageError, "ordered-package-pending"):
                write_book_package_manifest(
                    job_path=job_path,
                    job_root=job_root,
                    input_root=input_root,
                    book_id="dongpo-quanji",
                    book_title="东坡全集",
                    source_id="kanripo-kr4d0076",
                )

    def test_validator_detects_tampered_digest_and_unknown_field(self) -> None:
        temporary, _job_root, _job_path, input_root = self.make_workspace()
        with temporary:
            (input_root / "body.txt").write_text("正文\n", encoding="utf-8")
            manifest = self.build(input_root)
            manifest["packageSha256"] = "0" * 64
            manifest["privateText"] = "must not be accepted"
            validation = validate_book_package_manifest(manifest)
            self.assertFalse(validation.valid)
            self.assertIn("package-digest-mismatch", {issue.code for issue in validation.errors})
            self.assertIn("manifest-unknown-field", {issue.code for issue in validation.errors})


if __name__ == "__main__":
    unittest.main()
