# Internal Deployment Portal (AWS)

Secure internal tool: Cognito-authenticated users submit deployments; a Python Lambda validates input, records runs in DynamoDB, and starts **AWS Systems Manager Run Command** on EC2 instances tagged by environment. No SSH, no `shell=True` in application code.

Follow **[Complete deployment instructions (backend and frontend)](#complete-deployment-instructions-backend-and-frontend)** below for the full ordered checklist. **Deploy the backend first**, then the frontend (the UI needs the API URL and Cognito IDs from Terraform outputs).

## Architecture summary

| Layer | Technology |
|--------|------------|
| UI | React 18 + TypeScript (Vite), enterprise-style CSS |
| Hosting | S3 (private) + CloudFront (OAC) |
| Auth | Cognito User Pool (USER_PASSWORD_AUTH); JWT on API calls |
| API | API Gateway **HTTP API** + Lambda proxy (payload format 2.0) |
| AuthZ | API Gateway **JWT authorizer** (Cognito issuer + app client audience) |
| Execution | SSM `AWS-RunShellScript` → `/opt/deploy/scripts/{uat\|prod}_deployment.sh <release_folder>` |
| State | DynamoDB table keyed by `deployment_id` |
| Ops logs | CloudWatch Logs (`/aws/lambda/<name>-api`) |
| IaC | Terraform (`infra/`) |

**Flow:** Browser → CloudFront → SPA calls HTTPS API with `Authorization: Bearer <id token>`. API Gateway validates JWT. Lambda maps **only** `UAT` / `PROD` to fixed tag values and script paths (see `backend/config.py`), discovers **running** EC2 instances with `tag:Environment`, runs `send_command`, stores `command_id` and refreshes status on read via `get_command_invocation`.

## Folder structure

```
app-deployment-ccdc/
├── frontend/           # React + TypeScript SPA
├── backend/            # Lambda Python (handler, SSM, DynamoDB)
├── infra/              # Terraform (Cognito, API, Lambda, DynamoDB, S3, CloudFront)
├── scripts/            # package_lambda.ps1 / .sh → build/lambda.zip
├── sample-ec2/         # Example scripts to copy to /opt/deploy/scripts on EC2
├── build/              # Generated Lambda zip (gitignored)
└── README.md
```

---

## Complete deployment instructions (backend and frontend)

### What each part includes

| Part | Repository path | What gets deployed |
|------|------------------|-------------------|
| **Backend** | `backend/`, `scripts/`, `infra/` | **Lambda** (Python API), **API Gateway** HTTP API + JWT authorizer, **DynamoDB** table, **Cognito** user pool + SPA client, **IAM** roles/policies, **CloudWatch** log group, **S3** bucket + **CloudFront** distribution (empty until you upload the SPA). |
| **Frontend** | `frontend/` | Static files from **`npm run build`** → uploaded to the **S3** bucket Terraform created → served via **CloudFront**. |

**Rule:** run **backend (Terraform) first**, then **frontend (build + S3 sync)**. The SPA is configured at build time with `VITE_*` variables pointing at the API and Cognito.

### Prerequisites (both backend and frontend)

| Requirement | Check |
|-------------|--------|
| AWS account + IAM permissions | Can create Cognito, API Gateway, Lambda, DynamoDB, S3, CloudFront, IAM, Logs |
| [Terraform](https://www.terraform.io/) ≥ 1.5 | `terraform version` |
| [AWS CLI](https://aws.amazon.com/cli/) v2 | `aws sts get-caller-identity` |
| **Python 3** + `pip` | Used by packaging script for Lambda |
| **Node.js** 18+ and npm | `node -v`, `npm -v` for the React app |

Use the **same AWS credentials/profile** for Terraform and for `aws s3` / `aws cloudfront` (or equivalent IAM user/role with `s3:PutObject` on the frontend bucket and `cloudfront:CreateInvalidation`).

---

### Part A — Backend components (Terraform + Lambda package)

**A1. Open the repository**

```bash
cd app-deployment-ccdc
```

(Windows example: `cd d:\Madan\Complect\app-deployment-ccdc`.)

**A2. Build the Lambda deployment package**

Terraform reads **`build/lambda.zip`** (path relative to `infra/` is `../build/lambda.zip` by default).

*Windows (PowerShell), from repo root:*

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package_lambda.ps1
```

*Linux / macOS:*

```bash
chmod +x scripts/package_lambda.sh
./scripts/package_lambda.sh
```

Confirm **`build/lambda.zip`** exists. If packaging fails, ensure `python -m pip` works and try again.

**A3. Configure Terraform variables**

```bash
cd infra
```

*Windows:* `copy terraform.tfvars.example terraform.tfvars`  
*Linux/macOS:* `cp terraform.tfvars.example terraform.tfvars`

Edit **`terraform.tfvars`**:

- **`aws_region`** — region for API, Lambda, Cognito, DynamoDB, S3, etc. (default in example is often `us-east-1`).
- **`cors_allowed_origins`** — list of **exact** browser origins allowed to call the API.
  - **First apply:** you can use only local dev, e.g. `["http://localhost:5173"]`.
  - **After first apply:** copy **`cloudfront_url`** from outputs (e.g. `https://d123abc.cloudfront.net`), add it to the list **without a trailing slash**, then run **`terraform apply`** again so production SPA can call the API.

**A4. Initialize and apply infrastructure**

```bash
terraform init
terraform plan
terraform apply
```

Approve with `yes`. This creates all **backend** resources and the **empty** frontend S3 + CloudFront stack.

**A5. Record Terraform outputs**

```bash
terraform output
```

Save these for the frontend build and uploads:

| Output | Purpose |
|--------|---------|
| `api_invoke_url` | `VITE_API_URL` (no trailing `/`) |
| `cognito_user_pool_id` | `VITE_USER_POOL_ID` |
| `cognito_user_pool_client_id` | `VITE_USER_POOL_CLIENT_ID` |
| `cloudfront_url` | URL users open after frontend deploy |
| `frontend_bucket_name` | Target for `aws s3 sync` |
| `cloudfront_distribution_id` | Target for invalidation |

One-liners (from `infra/`):

```bash
terraform output -raw api_invoke_url
terraform output -raw cognito_user_pool_id
terraform output -raw cognito_user_pool_client_id
terraform output -raw frontend_bucket_name
terraform output -raw cloudfront_distribution_id
terraform output -raw cloudfront_url
```

**A6. Align CORS with production (second `apply` if needed)**

If **`cloudfront_url`** was not in `cors_allowed_origins` during the first apply, add it to **`terraform.tfvars`** and run:

```bash
terraform apply
```

**A7. Verify the API**

```bash
curl -sS "$(terraform output -raw api_invoke_url)/health"
```

Expect: `{"status":"ok"}` (or similar JSON).

**A8. Create a Cognito user**

1. AWS Console → **Cognito** → select the user pool (name includes your `project_name`, e.g. `deploy-portal`).
2. **Users** → **Create user** — use an **email**; the portal signs in with **email + password**.
3. Finish verification / temporary password steps required by your pool.

**Backend is ready** when: health endpoint responds, outputs are saved, **CORS** lists every origin you use (localhost + CloudFront), and at least one user exists in Cognito.

#### Optional: custom domain (Route 53 + ACM)

Configure in **`terraform.tfvars`** / variables:

- **`acm_certificate_arn_us_east_1`** — ACM certificate ARN in **us-east-1** (required for custom CloudFront hostnames).
- **`cloudfront_alias`** — list of hostnames (e.g. `["portal.example.com"]`).
- Or set **`create_acm_certificate`**, **`acm_domain_name`**, **`route53_zone_id`** to request ACM DNS validation via Route 53 (see `infra/s3_cloudfront.tf` and `variables.tf`).

---

### Part B — Frontend components (build SPA, upload to S3, invalidate CloudFront)

Do this **after** Part A outputs are available.

**B1. Create environment file for Vite**

From repo root:

*Windows:*

```powershell
cd frontend
copy ..\.env.example .env.local
```

*Linux / macOS:*

```bash
cd frontend
cp ../.env.example .env.local
```

**B2. Edit `frontend/.env.local`**

Set (no quotes around values in `.env.local`):

| Variable | Set to |
|----------|--------|
| `VITE_USER_POOL_ID` | Value of `cognito_user_pool_id` |
| `VITE_USER_POOL_CLIENT_ID` | Value of `cognito_user_pool_client_id` |
| `VITE_AWS_REGION` | Same region as Terraform (e.g. `us-east-1`) |
| `VITE_API_URL` | Value of `api_invoke_url` — **no trailing slash** |

Vite embeds these at **build time**. Changing them requires a **new build** and re-upload.

**B3. Install dependencies and production build**

```bash
cd frontend
npm ci
npm run build
```

Output directory: **`frontend/dist/`** (HTML, JS, CSS assets).

**B4. Upload static files to S3**

Use the bucket from **`frontend_bucket_name`**.

*Option 1 — from `frontend/` with explicit bucket name:*

```bash
aws s3 sync dist/ s3://YOUR_FRONTEND_BUCKET_NAME/ --delete
```

*Option 2 — from `infra/` using Terraform output:*

```bash
cd ../infra
aws s3 sync ../frontend/dist/ "s3://$(terraform output -raw frontend_bucket_name)/" --delete
```

**B5. Invalidate CloudFront cache**

```bash
aws cloudfront create-invalidation --distribution-id "$(terraform output -raw cloudfront_distribution_id)" --paths "/*"
```

(Run from `infra/` if using the command above as-is.)

**B6. End-to-end verification**

1. Open **`cloudfront_url`** in a browser.
2. Sign in with the Cognito user from **A8**.
3. Exercise the deployment form (real runs need EC2 + SSM configured per [EC2 and SSM prerequisites](#ec2-and-ssm-prerequisites)).

**B7. Ongoing frontend releases**

For each UI change:

```bash
cd frontend
npm ci
npm run build
cd ../infra
aws s3 sync ../frontend/dist/ "s3://$(terraform output -raw frontend_bucket_name)/" --delete
aws cloudfront create-invalidation --distribution-id "$(terraform output -raw cloudfront_distribution_id)" --paths "/*"
```

---

### Updating backend (Lambda) code later

When you change files under **`backend/`**:

1. Re-run the packaging script (from repo root) to regenerate **`build/lambda.zip`**.
2. From **`infra/`**: `terraform apply`  
   Terraform updates the Lambda when **`build/lambda.zip`** content/hash changes.

If you only change **`ALLOWED_CORS_ORIGINS`** or other Lambda **environment** variables in Terraform, `apply` is enough (no new zip required unless you also changed Python code).

---

### Local development (optional)

1. Deploy or point to an existing API (**Part A** outputs).
2. **`frontend/.env.local`** with `VITE_API_URL` = `api_invoke_url`.
3. `npm run dev` in **`frontend/`** (default port **5173**).
4. Ensure **`http://localhost:5173`** is in **`cors_allowed_origins`** in **`terraform.tfvars`** and applied.

---

## Sample API payloads

**POST /deploy** (requires `Authorization: Bearer <id_token>`)

Request body:

```json
{
  "environment": "UAT",
  "release_folder": "uat_20260323"
}
```

Success response (example):

```json
{
  "deployment_id": "dep-001",
  "status": "running",
  "environment": "UAT",
  "release_folder": "uat_20260323",
  "ssm_command_id": "abc123"
}
```

**GET /health** — no auth.

**GET /environments** — returns `{ "environments": [ { "id": "PROD", "label": "PROD" }, ... ] }`.

**GET /deployments** / **GET /deployments/{id}** — authenticated; detail refreshes SSM status when still in progress.

## EC2 and SSM prerequisites

1. **SSM Agent** installed and running on each target instance (Amazon Linux 2/2023 and recent Ubuntu AMIs usually include it).

2. **IAM instance profile** attached with policies that allow the instance to register with Systems Manager (e.g. `AmazonSSMManagedInstanceCore`). Instances must appear as **Managed** in the SSM Fleet Manager console.

3. **Tags:** Each target instance must have `Environment=UAT` or `Environment=PROD` (exact values used in `describe_instances` filters).

4. **Scripts:** Install sample scripts from `sample-ec2/opt/deploy/scripts/` onto the instance at:

   - `/opt/deploy/scripts/uat_deployment.sh`
   - `/opt/deploy/scripts/prod_deployment.sh`

   Then:

   ```bash
   sudo chmod +x /opt/deploy/scripts/*.sh
   ```

5. **SSM document:** Lambda uses the AWS-managed document `AWS-RunShellScript` (no custom document required).

## Cognito users

The Terraform stack creates a User Pool and a **public** SPA client (`USER_PASSWORD_AUTH`). Create users in the Cognito console (or API) with a verified email; users sign in with **email** and password in the portal.

## Local development

See **[Local development (optional)](#local-development-optional)** under [Complete deployment instructions](#complete-deployment-instructions-backend-and-frontend).

## Security decisions

| Topic | Decision |
|--------|-----------|
| Trust boundary | API never trusts client for script paths or EC2 tags; only `UAT`/`PROD` allowed and mapped server-side in `config.py`. |
| Input validation | `release_folder` validated with strict regex and max length in Lambda. |
| Authentication | JWT validated at API Gateway; Lambda reads `cognito:username` from authorizer context. |
| CORS | Allowlist only (`ALLOWED_CORS_ORIGINS` env on Lambda for echoed `Access-Control-Allow-Origin`; API Gateway CORS matches `cors_allowed_origins`). |
| Secrets | No secrets in repo; Cognito/API URLs via env / Terraform outputs. |
| IAM | Lambda role scoped to one DynamoDB table, EC2 describe, SSM run command + read invocations, and CloudWatch Logs for its log group. SSM is still broad (`Resource = *` for commands); tighten with org policies / resource tags as you mature. |
| Frontend tokens | ID / access / refresh tokens stored in **sessionStorage** (cleared when the tab session ends). Use organization-managed devices and SSO hardening as appropriate. |
| Data | S3 bucket is private; CloudFront OAC only. DynamoDB encryption at rest default (AWS owned key in this template). |

## Polling

The dashboard polls **GET /deployments/{id}** every 4 seconds after a submit until status is `success` or `failed`, and refreshes list data on demand or after submit.

## Troubleshooting

- **403 from API in browser:** Check CORS list includes the exact origin (scheme + host, no trailing slash).
- **401 on API:** Token expired — sign in again. Ensure API authorizer audience matches the Cognito app client ID.
- **No targets / deploy error:** Confirm EC2 instances are `running`, tagged `Environment=UAT` or `PROD`, and SSM shows them online.
- **InvocationDoesNotExist:** Normal immediately after `send_command`; status stays `running` until SSM records invocations.

## License

Internal use; adjust as required for your organization.
