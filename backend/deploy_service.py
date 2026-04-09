"""SSM Run Command orchestration and EC2 target resolution."""

from __future__ import annotations

import re
from typing import Any

import boto3
from botocore.exceptions import ClientError

from config import (
    AWS_REGION,
    ENVIRONMENT_CONFIG,
    RELEASE_FOLDER_MAX_LEN,
    RELEASE_FOLDER_PATTERN,
    SSM_DOCUMENT_NAME,
)

_ec2 = boto3.client("ec2", region_name=AWS_REGION)
_ssm = boto3.client("ssm", region_name=AWS_REGION)


def validate_release_folder(release_folder: str) -> tuple[bool, str | None]:
    if not release_folder or not isinstance(release_folder, str):
        return False, "release_folder is required"
    if len(release_folder) > RELEASE_FOLDER_MAX_LEN:
        return False, "release_folder exceeds maximum length"
    if not re.fullmatch(RELEASE_FOLDER_PATTERN, release_folder):
        return (
            False,
            "release_folder must contain only letters, numbers, underscore, and hyphen",
        )
    return True, None


def resolve_environment(environment: str) -> dict[str, str] | None:
    if not environment or not isinstance(environment, str):
        return None
    key = environment.strip().upper()
    return ENVIRONMENT_CONFIG.get(key)


def list_target_instance_ids(ec2_tag_value: str) -> list[str]:
    """EC2 instances tagged Environment=<value>, running only."""
    paginator = _ec2.get_paginator("describe_instances")
    ids: list[str] = []
    for page in paginator.paginate(
        Filters=[
            {"Name": "tag:Environment", "Values": [ec2_tag_value]},
            {"Name": "instance-state-name", "Values": ["running"]},
        ]
    ):
        for rsv in page.get("Reservations", []):
            for inst in rsv.get("Instances", []):
                iid = inst.get("InstanceId")
                if iid:
                    ids.append(iid)
    return ids


def send_deploy_command(
    instance_ids: list[str],
    script_path: str,
    release_folder: str,
) -> str:
    """
    Run deployment script via SSM Run Command (no SSH).
    Single shell command line: script_path + space + release_folder argument.
    """
    # Build one command string — SSM RunShellScript runs each entry with sh -c; no shell=True in our code.
    command_line = f"{script_path} {release_folder}"
    resp = _ssm.send_command(
        DocumentName=SSM_DOCUMENT_NAME,
        InstanceIds=instance_ids,
        Parameters={"commands": [command_line]},
        TimeoutSeconds=3600,
        Comment="Deployment portal",
    )
    return resp["Command"]["CommandId"]


def refresh_invocation_status(
    command_id: str, instance_ids: list[str]
) -> dict[str, Any]:
    """Aggregate SSM invocation results across instances."""
    statuses: list[str] = []
    stdouts: list[str] = []
    stderrs: list[str] = []
    exit_codes: list[int | None] = []

    for iid in instance_ids:
        try:
            inv = _ssm.get_command_invocation(CommandId=command_id, InstanceId=iid)
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code == "InvocationDoesNotExist":
                statuses.append("Pending")
                stdouts.append("")
                stderrs.append("")
                exit_codes.append(None)
                continue
            raise
        st = inv.get("Status", "Unknown")
        statuses.append(st)
        stdouts.append(inv.get("StandardOutputContent", "") or "")
        stderrs.append(inv.get("StandardErrorContent", "") or "")
        ec = inv.get("ResponseCode")
        exit_codes.append(ec if ec is not None else None)

    terminal_failed = {"Failed", "Cancelled", "TimedOut", "Undeliverable", "Terminated"}
    terminal_success = {"Success"}
    in_flight = {"InProgress", "Pending", "Delayed"}

    if any(s in terminal_failed for s in statuses):
        overall = "failed"
    elif instance_ids and all(s in terminal_success for s in statuses):
        overall = "success"
    elif any(s in in_flight or s not in terminal_failed | terminal_success for s in statuses):
        overall = "running"
    else:
        overall = "running"

    return {
        "status": overall,
        "stdout": "\n---\n".join(stdouts),
        "stderr": "\n---\n".join(stderrs),
        "exit_code": exit_codes[0] if len(exit_codes) == 1 else None,
        "raw_statuses": statuses,
    }
