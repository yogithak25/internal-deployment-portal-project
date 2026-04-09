# Copy to terraform.tfvars and adjust. Do not commit secrets.

aws_region = "us-east-1"
project_name = "deploy-portal"

# After first apply, add your CloudFront URL and keep localhost for dev:
cors_allowed_origins = [
  "https://dud9gqs38dwfl.cloudfront.net",
  "http://localhost:5173",
  "http://52.13.32.128:5173"
]

# Path to Lambda zip (from infra/ directory)
# lambda_zip_path = "../build/lambda.zip"

# Optional custom domain (requires ACM in us-east-1)
# acm_certificate_arn_us_east_1 = "arn:aws:acm:us-east-1:123456789012:certificate/..."
# cloudfront_alias                = ["portal.example.com"]

# Optional: request ACM + DNS validation via Route 53
# create_acm_certificate = true
# acm_domain_name        = "portal.example.com"
# route53_zone_id        = "Z0123456789ABCDEF"
