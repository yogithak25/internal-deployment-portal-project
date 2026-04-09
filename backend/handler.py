"""
API Gateway HTTP API (v2) Lambda handler.
Public: GET /health. Authenticated: /environments, /deploy, /deployments.
JWT validated by API Gateway authorizer; username read from request context.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from urllib.parse import unquote

from botocore.exceptions import ClientError

from config import ALLOWED_CORS_ORIGINS, ENVIRONMENT_CONFIG
from db import (
    _now_iso,
    get_deployment,
    list_deployments,
    new_deployment_id,
    put_deployment,
    update_deployment,
)
from deploy_service import (
    list_target_instance_ids,
    refresh_invocation_status,
    resolve_environment,
    send_deploy_command,
    validate_release_folder,
)

logger = logging.getLogger()
if not logger.handlers:
    logging.basicConfig(level=logging.INFO)
logger.setLevel(logging.INFO)


def _cors_headers(event: dict[str, Any]) -> dict[str, str]:
    origin = ""
    headers = event.get("headers") or {}
    if isinstance(headers, dict):
        origin = headers.get("origin") or headers.get("Origin") or ""
    allowed = [o.strip() for o in ALLOWED_CORS_ORIGINS.split(",") if o.strip()]
    cors_origin = origin if origin in allowed else (allowed[0] if len(allowed) == 1 else "")
    if not cors_origin and allowed:
        cors_origin = allowed[0]
    h: dict[str, str] = {
        "Content-Type": "application/json",
    }
    if cors_origin:
        h["Access-Control-Allow-Origin"] = cors_origin
        h["Access-Control-Allow-Headers"] = "Content-Type,Authorization"
        h["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
        h["Access-Control-Allow-Credentials"] = "true"
    return h


def _response(
    status_code: int,
    body: dict[str, Any] | list[Any] | str,
    event: dict[str, Any],
) -> dict[str, Any]:
    payload = body if isinstance(body, str) else json.dumps(body, default=str)
    return {
        "statusCode": status_code,
        "headers": _cors_headers(event),
        "body": payload,
    }


def _get_username(event: dict[str, Any]) -> str | None:
    rc = event.get("requestContext", {}) or {}
    auth = rc.get("authorizer", {}) or {}
    jwt_claims = (auth.get("jwt") or {}).get("claims") or {}
    if jwt_claims:
        return (
            jwt_claims.get("cognito:username")
            or jwt_claims.get("username")
            or jwt_claims.get("sub")
        )
    claims = auth.get("claims") or {}
    if claims:
        return claims.get("cognito:username") or claims.get("sub")
    return None


def _route_parts(event: dict[str, Any]) -> tuple[str, str]:
    rc = event.get("requestContext", {}) or {}
    http = rc.get("http", {}) or {}
    method = http.get("method") or event.get("requestContext", {}).get("httpMethod", "GET")
    path = event.get("rawPath") or event.get("path", "")
    return method.upper(), path


def _handle_health(event: dict[str, Any]) -> dict[str, Any]:
    return _response(200, {"status": "ok"}, event)


def _handle_environments(event: dict[str, Any]) -> dict[str, Any]:
    envs = [{"id": k, "label": k} for k in sorted(ENVIRONMENT_CONFIG.keys())]
    return _response(200, {"environments": envs}, event)


def _handle_deploy_post(event: dict[str, Any]) -> dict[str, Any]:
    user = _get_username(event)
    if not user:
        return _response(401, {"error": "Unauthorized"}, event)

    try:
        body_raw = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            import base64

            body_raw = base64.b64decode(body_raw).decode("utf-8")
        payload = json.loads(body_raw)
    except (json.JSONDecodeError, ValueError) as e:
        return _response(400, {"error": "Invalid JSON body", "detail": str(e)}, event)

    env_raw = payload.get("environment")
    release_folder = payload.get("release_folder")

    cfg = resolve_environment(str(env_raw) if env_raw is not None else "")
    if not cfg:
        return _response(
            400,
            {"error": "Invalid environment", "allowed": list(ENVIRONMENT_CONFIG.keys())},
            event,
        )

    ok, err = validate_release_folder(str(release_folder) if release_folder is not None else "")
    if not ok:
        return _response(400, {"error": err}, event)

    rf = str(release_folder).strip()
    tag_val = cfg["ec2_tag_value"]
    script_path = cfg["script_path"]

    try:
        instance_ids = list_target_instance_ids(tag_val)
    except ClientError as e:
        logger.exception("EC2 describe failed")
        return _response(502, {"error": "Failed to resolve targets", "detail": str(e)}, event)

    if not instance_ids:
        return _response(
            400,
            {
                "error": f"No running EC2 instances found with tag Environment={tag_val}",
            },
            event,
        )

    deployment_id = new_deployment_id()
    created = _now_iso()

    env_key = str(env_raw).strip().upper()
    item = {
        "deployment_id": deployment_id,
        "username": user,
        "environment": env_key,
        "release_folder": rf,
        "target_instance_ids": instance_ids,
        "script_path": script_path,
        "ssm_command_id": "",
        "status": "pending",
        "stdout": "",
        "stderr": "",
        "exit_code": None,
        "created_at": created,
        "updated_at": created,
    }

    try:
        put_deployment(item)
    except ClientError as e:
        logger.exception("DynamoDB put failed")
        return _response(502, {"error": "Failed to persist deployment", "detail": str(e)}, event)

    try:
        cmd_id = send_deploy_command(instance_ids, script_path, rf)
    except ClientError as e:
        logger.exception("SSM send_command failed")
        try:
            update_deployment(
                deployment_id,
                {"status": "failed", "stderr": str(e), "ssm_command_id": ""},
            )
        except ClientError:
            pass
        return _response(502, {"error": "Failed to start deployment", "detail": str(e)}, event)

    try:
        update_deployment(deployment_id, {"ssm_command_id": cmd_id, "status": "running"})
    except ClientError as e:
        logger.warning("Failed to update command id: %s", e)

    return _response(
        200,
        {
            "deployment_id": deployment_id,
            "status": "running",
            "environment": item["environment"],
            "release_folder": rf,
            "ssm_command_id": cmd_id,
        },
        event,
    )


def _sync_deployment_status(record: dict[str, Any]) -> dict[str, Any]:
    """Refresh SSM status into DynamoDB for non-terminal records."""
    cmd_id = record.get("ssm_command_id") or ""
    iids = record.get("target_instance_ids") or []
    st = record.get("status")
    if not cmd_id or not iids or st in ("success", "failed"):
        return record
    try:
        agg = refresh_invocation_status(cmd_id, iids)
    except ClientError as e:
        logger.warning("SSM refresh failed: %s", e)
        return record
    updates: dict[str, Any] = {
        "status": agg["status"],
        "stdout": agg["stdout"],
        "stderr": agg["stderr"],
    }
    if agg.get("exit_code") is not None:
        updates["exit_code"] = agg["exit_code"]
    try:
        update_deployment(record["deployment_id"], updates)
    except ClientError:
        pass
    record = {**record, **updates}
    return record


def _handle_deployments_list(event: dict[str, Any]) -> dict[str, Any]:
    if not _get_username(event):
        return _response(401, {"error": "Unauthorized"}, event)
    try:
        items = list_deployments(100)
    except ClientError as e:
        return _response(502, {"error": "Failed to list deployments", "detail": str(e)}, event)
    # Light refresh for running items (optional; keeps table fresher on list view)
    out = []
    for it in items:
        out.append(_sync_deployment_status(dict(it)))
    return _response(200, {"deployments": out}, event)


def _handle_deployment_get(deployment_id: str, event: dict[str, Any]) -> dict[str, Any]:
    if not _get_username(event):
        return _response(401, {"error": "Unauthorized"}, event)
    deployment_id = unquote(deployment_id)
    try:
        rec = get_deployment(deployment_id)
    except ClientError as e:
        return _response(502, {"error": "Lookup failed", "detail": str(e)}, event)
    if not rec:
        return _response(404, {"error": "Not found"}, event)
    rec = _sync_deployment_status(dict(rec))
    return _response(200, rec, event)


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    method, path = _route_parts(event)

    if method == "OPTIONS":
        return {"statusCode": 204, "headers": _cors_headers(event), "body": ""}

    # Normalize path (stage prefix stripped by API GW in some setups)
    path = path.rstrip("/") or "/"
    if path.endswith("/health") or path == "/health":
        if method == "GET":
            return _handle_health(event)
    if path == "/environments" or path.endswith("/environments"):
        if method == "GET":
            if not _get_username(event):
                return _response(401, {"error": "Unauthorized"}, event)
            return _handle_environments(event)
    if path == "/deploy" or path.endswith("/deploy"):
        if method == "POST":
            return _handle_deploy_post(event)
    dep_id = ""
    path_params = event.get("pathParameters") or {}
    raw_id = path_params.get("id") or path_params.get("deployment_id")
    if raw_id:
        dep_id = str(raw_id).strip()
    elif "/deployments/" in path:
        parts = [p for p in path.split("/") if p]
        try:
            idx = parts.index("deployments")
            dep_id = parts[idx + 1] if idx + 1 < len(parts) else ""
        except (ValueError, IndexError):
            dep_id = ""
    if method == "GET" and dep_id:
        return _handle_deployment_get(dep_id, event)
    if path == "/deployments" or path.endswith("/deployments"):
        if method == "GET":
            return _handle_deployments_list(event)

    return _response(404, {"error": "Not found"}, event)
