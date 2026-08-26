#!/usr/bin/env python3
"""Focused tests for the isolated poet-map job contract."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from poet_map_job import (  # noqa: E402
    REQUIRED_REFERENCE_IDS,
    STAGE_DIRECTORIES,
    STAGE_NAMES,
    build_job_manifest,
    complete_stages,
    initialize_job,
    load_job,
    make_artifact,
    validate_job_manifest,
)


SHA = "a" * 64


def snapshots() -> list[dict[str, str]]:
    return [
        {
            "registry": "source-catalog" if reference_id == "source-materials" else "raw-layer",
            "referenceId": reference_id,
            "manifestPath": "source-materials/source-manifest.json"
            if reference_id == "source-materials"
            else "data/raw-layer-manifest.json",
            "sha256": hashlib.sha256(reference_id.encode("utf-8")).hexdigest(),
        }
        for reference_id in REQUIRED_REFERENCE_IDS
    ]


def valid_job() -> dict:
    return build_job_manifest(
        job_id="pmj-20260803-0123456789abcdef",
        created_at="2026-08-03T00:00:00Z",
        poet_id="li-bai",
        poet_name="李白",
        source_id="upload-li-bai-biography",
        input_sha256=SHA,
        content_type="application/pdf",
        access_level="quarantine",
        data_processing_consent=True,
        external_transfer_consent=False,
        allow_external_providers=False,
        max_api_requests=0,
        max_tokens=None,
        max_cost_cny=None,
        publication_mode="private-preview-only",
        source=None,
        snapshots=snapshots(),
    )


def stage_artifact(job_root: Path, stage: str) -> dict:
    relative_path = f"{STAGE_DIRECTORIES[stage]}/{stage}-output.json"
    (job_root / relative_path).write_text(
        json.dumps({"recordType": f"{stage}-stage-output"}, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    return make_artifact(
        job_root,
        stage=stage,
        artifact_id=f"{stage}-artifact",
        record_type=f"{stage}-stage-output",
        relative_path=relative_path,
    )


class PoetMapJobTest(unittest.TestCase):
    def test_fresh_job_is_valid_with_unregistered_upload_warning(self) -> None:
        validation = validate_job_manifest(valid_job())
        self.assertTrue(validation.valid, validation.payload())
        self.assertEqual((), validation.errors)
        self.assertEqual({"input-unregistered"}, {issue.code for issue in validation.warnings})

    def test_external_provider_requires_explicit_transfer_consent(self) -> None:
        with self.assertRaisesRegex(ValueError, "external-transfer consent"):
            build_job_manifest(
                **{
                    **valid_job_arguments(),
                    "allow_external_providers": True,
                    "external_transfer_consent": False,
                }
            )

    def test_missing_reference_snapshot_fails_validation(self) -> None:
        job = valid_job()
        job["referenceSnapshots"] = job["referenceSnapshots"][:-1]
        validation = validate_job_manifest(job)
        self.assertFalse(validation.valid)
        self.assertIn("reference-missing-required", {issue.code for issue in validation.errors})

    def test_validator_rejects_invalid_nested_poet_and_input_fields(self) -> None:
        job = valid_job()
        job["poet"].pop("name")
        job["poet"]["privateNote"] = "must not enter the job manifest"
        job["poet"]["aliases"] = ["太白", "太白", 7]
        job["input"].pop("contentType")
        job["input"]["privateText"] = "must not enter the job manifest"
        job["input"]["dataProcessingConsent"] = "yes"
        job["input"]["sourceVersion"] = {"type": "", "debug": "no"}
        job["input"]["retentionExpiresAt"] = "not-a-timestamp"

        validation = validate_job_manifest(job)
        codes = {issue.code for issue in validation.errors}

        self.assertFalse(validation.valid)
        self.assertTrue(
            {
                "poet-missing-field",
                "poet-unknown-field",
                "poet-alias",
                "poet-alias-duplicate",
                "input-missing-field",
                "input-unknown-field",
                "input-consent-type",
                "input-source-version-missing-field",
                "input-source-version-field",
                "input-source-version-unknown-field",
                "input-retention-expiry",
            }.issubset(codes),
            codes,
        )

    def test_validator_rejects_invalid_nested_policy_and_reference_fields(self) -> None:
        job = valid_job()
        job["policy"].pop("policyVersion")
        job["policy"]["privatePrompt"] = "must not enter the job manifest"
        job["policy"]["allowExternalProviders"] = "false"
        job["policy"]["maxApiRequests"] = True
        job["policy"]["maxTokens"] = -1
        job["policy"]["maxCostCny"] = True
        job["referenceSnapshots"][0].pop("manifestPath")
        job["referenceSnapshots"][1]["privatePrompt"] = "must not enter the job manifest"
        job["referenceSnapshots"][1]["manifestPath"] = "data\\raw-layer-manifest.json"

        validation = validate_job_manifest(job)
        codes = {issue.code for issue in validation.errors}

        self.assertFalse(validation.valid)
        self.assertTrue(
            {
                "policy-missing-field",
                "policy-unknown-field",
                "policy-external-provider-type",
                "policy-api-budget",
                "policy-token-budget",
                "policy-cost-budget",
                "reference-missing-field",
                "reference-unknown-field",
                "reference-path",
            }.issubset(codes),
            codes,
        )

    def test_validator_rejects_explicit_null_optional_fields(self) -> None:
        job = valid_job()
        job["poet"]["existingPersonId"] = None
        job["poet"]["aliases"] = None
        job["input"]["sourceVersion"] = None
        job["input"]["retentionExpiresAt"] = None
        job["policy"]["maxTokens"] = None
        job["policy"]["maxCostCny"] = None

        validation = validate_job_manifest(job)
        codes = {issue.code for issue in validation.errors}

        self.assertFalse(validation.valid)
        self.assertTrue(
            {
                "poet-existing-person-id",
                "poet-aliases",
                "input-source-version",
                "input-retention-expiry",
                "policy-token-budget",
                "policy-cost-budget",
            }.issubset(codes),
            codes,
        )

    def test_initialize_writes_only_isolated_job_layout(self) -> None:
        job = valid_job()
        with tempfile.TemporaryDirectory() as temporary_directory:
            job_root = Path(temporary_directory) / "jobs"
            path = initialize_job(job_root, job)
            self.assertEqual(path / "job.json", path / "job.json")
            self.assertTrue((path / "job.json").is_file())
            self.assertTrue((path / "00-intake").is_dir())
            self.assertTrue((path / "08-map").is_dir())
            self.assertTrue((path / "audit").is_dir())
            self.assertEqual(job, json.loads((path / "job.json").read_text(encoding="utf-8")))
            with self.assertRaisesRegex(ValueError, "already exists"):
                initialize_job(job_root, job)

    def test_completed_stage_records_verified_artifact_without_overwrite(self) -> None:
        job = valid_job()
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = initialize_job(Path(temporary_directory) / "jobs", job)
            receipt = path / "00-intake" / "receipt.json"
            receipt.write_text('{"recordType":"intake-receipt"}\n', encoding="utf-8")
            artifact = make_artifact(
                path,
                stage="intake",
                artifact_id="intake-receipt",
                record_type="intake-receipt",
                relative_path="00-intake/receipt.json",
            )
            completed = complete_stages(
                path / "job.json",
                stage_names=("intake",),
                artifacts=(artifact,),
                actor="test",
                reason="receipt complete",
            )
            self.assertEqual("succeeded", completed["stages"][0]["status"])
            self.assertEqual("running", completed["status"])
            self.assertEqual([artifact], completed["artifacts"])
            with self.assertRaisesRegex(ValueError, "already exists|not pending"):
                complete_stages(
                    path / "job.json",
                    stage_names=("intake",),
                    artifacts=(artifact,),
                    actor="test",
                    reason="must not overwrite",
                )

    def test_registered_artifact_is_rechecked_on_load_and_cli_validate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = initialize_job(Path(temporary_directory) / "jobs", valid_job())
            receipt = path / "00-intake" / "receipt.json"
            receipt.write_text('{"recordType":"intake-receipt"}\n', encoding="utf-8")
            artifact = make_artifact(
                path,
                stage="intake",
                artifact_id="intake-receipt",
                record_type="intake-receipt",
                relative_path="00-intake/receipt.json",
            )
            complete_stages(
                path / "job.json",
                stage_names=("intake",),
                artifacts=(artifact,),
                actor="test",
                reason="Register an artifact before integrity verification.",
            )
            self.assertEqual("running", load_job(path / "job.json")["status"])

            receipt.write_text('{"recordType":"tampered"}\n', encoding="utf-8")
            persisted = json.loads((path / "job.json").read_text(encoding="utf-8"))
            validation = validate_job_manifest(persisted, artifact_root=path)
            self.assertFalse(validation.valid)
            self.assertIn("artifact-sha256-mismatch", {issue.code for issue in validation.errors})
            with self.assertRaisesRegex(ValueError, "artifact-sha256-mismatch"):
                load_job(path / "job.json")

            result = subprocess.run(
                [
                    sys.executable,
                    "-B",
                    str(SCRIPT_ROOT / "poet_map_job.py"),
                    "validate",
                    "--job",
                    str(path / "job.json"),
                    "--json",
                ],
                cwd=SCRIPT_ROOT.parent,
                capture_output=True,
                check=False,
                text=True,
            )
            self.assertEqual(1, result.returncode, result.stderr)
            cli_output = json.loads(result.stdout)
            self.assertIn(
                "artifact-sha256-mismatch",
                {issue["code"] for issue in cli_output["issues"]},
            )

    def test_validator_rejects_succeeded_stage_without_registered_artifact(self) -> None:
        job = valid_job()
        job["stages"][0].update(
            {
                "status": "succeeded",
                "fingerprint": SHA,
                "completedAt": "2026-08-03T00:01:00Z",
            }
        )
        job["status"] = "running"
        job["transitions"].append(
            {
                "at": "2026-08-03T00:01:00Z",
                "from": "intake-pending",
                "to": "running",
                "actor": "test",
                "reason": "Unsafe direct manifest mutation for regression coverage.",
            }
        )

        validation = validate_job_manifest(job)

        self.assertFalse(validation.valid)
        self.assertIn("stage-missing-artifact", {issue.code for issue in validation.errors})

    def test_validator_rejects_artifactless_released_pipeline(self) -> None:
        job = valid_job()
        for stage in job["stages"]:
            stage.update(
                {
                    "status": "succeeded",
                    "fingerprint": SHA,
                    "completedAt": "2026-08-03T00:01:00Z",
                }
            )
        job["status"] = "released"
        job["transitions"].append(
            {
                "at": "2026-08-03T00:01:00Z",
                "from": "intake-pending",
                "to": "released",
                "actor": "test",
                "reason": "Unsafe direct manifest mutation for regression coverage.",
            }
        )

        validation = validate_job_manifest(job)

        self.assertFalse(validation.valid)
        self.assertEqual(
            len(STAGE_NAMES),
            sum(issue.code == "stage-missing-artifact" for issue in validation.errors),
        )

    def test_complete_stages_rejects_empty_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = initialize_job(Path(temporary_directory) / "jobs", valid_job())

            with self.assertRaisesRegex(ValueError, "requires at least one verified artifact"):
                complete_stages(
                    path / "job.json",
                    stage_names=STAGE_NAMES,
                    artifacts=(),
                    actor="test",
                    reason="A stage cannot be successful without output.",
                )

            persisted = json.loads((path / "job.json").read_text(encoding="utf-8"))
            self.assertEqual("intake-pending", persisted["status"])
            self.assertTrue(all(stage["status"] == "pending" for stage in persisted["stages"]))

    def test_complete_stages_rejects_released_and_incomplete_approval_states(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = initialize_job(Path(temporary_directory) / "jobs", valid_job())
            artifact = stage_artifact(path, "intake")

            with self.assertRaisesRegex(ValueError, "cannot be marked released"):
                complete_stages(
                    path / "job.json",
                    stage_names=("intake",),
                    artifacts=(artifact,),
                    actor="test",
                    reason="Private job execution cannot claim publication.",
                    final_status="released",
                )

            with self.assertRaisesRegex(ValueError, "requires every standard stage to succeed"):
                complete_stages(
                    path / "job.json",
                    stage_names=("intake",),
                    artifacts=(artifact,),
                    actor="test",
                    reason="Private preview status must have a complete private pipeline.",
                    final_status="approved-private-preview",
                )

    def test_full_private_preview_path_remains_valid(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = initialize_job(Path(temporary_directory) / "jobs", valid_job())
            artifacts = {stage: stage_artifact(path, stage) for stage in STAGE_NAMES}

            running = complete_stages(
                path / "job.json",
                stage_names=("intake", "extract"),
                artifacts=(artifacts["intake"], artifacts["extract"]),
                actor="test",
                reason="Private intake and extraction completed.",
            )
            self.assertEqual("running", running["status"])

            completed = complete_stages(
                path / "job.json",
                stage_names=STAGE_NAMES[2:],
                artifacts=tuple(artifacts[stage] for stage in STAGE_NAMES[2:]),
                actor="test",
                reason="Offline private route stages completed.",
                final_status="approved-private-preview",
            )

            validation = validate_job_manifest(completed)
            self.assertTrue(validation.valid, validation.payload())
            self.assertEqual("approved-private-preview", completed["status"])
            self.assertTrue(all(stage["status"] == "succeeded" for stage in completed["stages"]))
            self.assertEqual(len(STAGE_NAMES), len(completed["artifacts"]))

            forged_release = json.loads(json.dumps(completed))
            forged_release["status"] = "released"
            forged_release["transitions"][-1]["to"] = "released"
            validation = validate_job_manifest(forged_release)
            self.assertFalse(validation.valid)
            self.assertIn("job-release-unsupported", {issue.code for issue in validation.errors})


def valid_job_arguments() -> dict:
    return {
        "job_id": "pmj-20260803-0123456789abcdef",
        "created_at": "2026-08-03T00:00:00Z",
        "poet_id": "li-bai",
        "poet_name": "李白",
        "source_id": "upload-li-bai-biography",
        "input_sha256": SHA,
        "content_type": "application/pdf",
        "access_level": "quarantine",
        "data_processing_consent": True,
        "external_transfer_consent": False,
        "allow_external_providers": False,
        "max_api_requests": 0,
        "max_tokens": None,
        "max_cost_cny": None,
        "publication_mode": "private-preview-only",
        "source": None,
        "snapshots": snapshots(),
    }


if __name__ == "__main__":
    unittest.main()
