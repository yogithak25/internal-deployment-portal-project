"""DynamoDB persistence for deployment records."""

from __future__ import annotations

import time
import uuid
from typing import Any

import boto3
from botocore.exceptions import ClientError

from config import AWS_REGION, DEPLOYMENTS_TABLE_NAME

_dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
_table = _dynamodb.Table(DEPLOYMENTS_TABLE_NAME)


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def new_deployment_id() -> str:
    return f"dep-{uuid.uuid4().hex[:12]}"


def put_deployment(item: dict[str, Any]) -> None:
    clean = {k: v for k, v in item.items() if v is not None}
    _table.put_item(Item=clean)


def get_deployment(deployment_id: str) -> dict[str, Any] | None:
    try:
        resp = _table.get_item(Key={"deployment_id": deployment_id})
    except ClientError:
        raise
    return resp.get("Item")


def update_deployment(deployment_id: str, updates: dict[str, Any]) -> None:
    names: dict[str, str] = {}
    values: dict[str, Any] = {":u": _now_iso()}
    expr = "SET updated_at = :u"
    i = 0
    for k, v in updates.items():
        if k == "deployment_id":
            continue
        nk = f"#n{i}"
        vk = f":v{i}"
        names[nk] = k
        values[vk] = v
        expr += f", {nk} = {vk}"
        i += 1
    _table.update_item(
        Key={"deployment_id": deployment_id},
        UpdateExpression=expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def list_deployments(limit: int = 100) -> list[dict[str, Any]]:
    # Simple scan with limit; for scale use GSI on created_at
    resp = _table.scan(Limit=limit)
    items = resp.get("Items", [])
    while resp.get("LastEvaluatedKey") and len(items) < limit:
        resp = _table.scan(
            ExclusiveStartKey=resp["LastEvaluatedKey"],
            Limit=limit - len(items),
        )
        items.extend(resp.get("Items", []))
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return items[:limit]
