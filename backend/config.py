"""Environment-driven configuration. No secrets hardcoded."""

import os
from typing import Final

AWS_REGION: Final[str] = os.environ.get("AWS_REGION", "us-east-1")
DEPLOYMENTS_TABLE_NAME: Final[str] = os.environ["DEPLOYMENTS_TABLE_NAME"]
COGNITO_USER_POOL_ID: Final[str] = os.environ.get("COGNITO_USER_POOL_ID", "")
COGNITO_REGION: Final[str] = os.environ.get("COGNITO_REGION", AWS_REGION)
ALLOWED_CORS_ORIGINS: Final[str] = os.environ.get("ALLOWED_CORS_ORIGINS", "")

# Backend-only environment → EC2 tag value and script path (never from client beyond env name)
ENVIRONMENT_CONFIG: Final[dict[str, dict[str, str]]] = {
    "UAT": {
        "ec2_tag_value": "UAT",
        "script_path": "/opt/deploy/scripts/uat_deployment.sh",
    },
    "PROD": {
        "ec2_tag_value": "PROD",
        "script_path": "/opt/deploy/scripts/prod_deployment.sh",
    },
}

RELEASE_FOLDER_PATTERN: Final[str] = r"^[a-zA-Z0-9_-]+$"
RELEASE_FOLDER_MAX_LEN: Final[int] = 256

SSM_DOCUMENT_NAME: Final[str] = "AWS-RunShellScript"
