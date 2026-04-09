variable "aws_region" {
  type        = string
  description = "Primary AWS region for workloads (API, Lambda, DynamoDB, Cognito)."
  default     = "us-east-1"
}

variable "project_name" {
  type        = string
  description = "Short name prefix for resources."
  default     = "deploy-portal"
}

variable "lambda_zip_path" {
  type        = string
  description = "Path to Lambda deployment package (zip), relative to infra/ when running terraform from infra/."
  default     = "../build/lambda.zip"
}

variable "cors_allowed_origins" {
  type        = list(string)
  description = "Exact origins allowed for CORS (CloudFront URL and http://localhost:5173 for local dev)."
  default     = ["http://localhost:5173"]
}

variable "cloudfront_price_class" {
  type        = string
  description = "CloudFront price class."
  default     = "PriceClass_100"
}

variable "create_acm_certificate" {
  type        = bool
  description = "If true, request a public ACM cert in us-east-1 (requires Route 53 hosted zone)."
  default     = false
}

variable "acm_domain_name" {
  type        = string
  description = "FQDN for ACM certificate when create_acm_certificate is true (e.g. portal.example.com)."
  default     = ""
}

variable "route53_zone_id" {
  type        = string
  description = "Route 53 hosted zone ID for DNS validation / alias (optional)."
  default     = ""
}

variable "cloudfront_alias" {
  type        = list(string)
  description = "Alternate domain names (CNAMEs) for CloudFront; requires ACM ARN in us-east-1."
  default     = []
}

variable "acm_certificate_arn_us_east_1" {
  type        = string
  description = "Existing ACM certificate ARN in us-east-1 for custom CloudFront domain (optional)."
  default     = ""
}

variable "log_retention_days" {
  type        = number
  default     = 30
}
