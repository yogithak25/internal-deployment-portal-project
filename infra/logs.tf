resource "aws_cloudwatch_log_group" "lambda_api" {
  name              = "/aws/lambda/${local.name_prefix}-api"
  retention_in_days = var.log_retention_days
}
