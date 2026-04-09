output "api_invoke_url" {
  description = "HTTP API base URL (append /health, /deploy, etc.)."
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_user_pool_client_id" {
  value = aws_cognito_user_pool_client.spa.id
}

output "cognito_region" {
  value = var.aws_region
}

output "dynamodb_table_name" {
  value = aws_dynamodb_table.deployments.name
}

output "frontend_bucket_name" {
  value = aws_s3_bucket.frontend.bucket
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.frontend.domain_name
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.frontend.id
}

output "cloudfront_url" {
  value = "https://${aws_cloudfront_distribution.frontend.domain_name}"
}

output "acm_certificate_arn" {
  description = "ACM cert ARN in us-east-1 when create_acm_certificate is enabled (else null)."
  value       = try(aws_acm_certificate.portal[0].arn, null)
}

output "jwt_issuer" {
  value = local.issuer
}
