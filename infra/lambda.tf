resource "aws_lambda_function" "api" {
  function_name = "${local.name_prefix}-api"
  role          = aws_iam_role.lambda.arn
  handler       = "handler.lambda_handler"
  runtime       = "python3.12"
  timeout       = 60
  memory_size   = 256

  filename         = var.lambda_zip_path
  source_code_hash = filebase64sha256(var.lambda_zip_path)

  environment {
    variables = {
      DEPLOYMENTS_TABLE_NAME = aws_dynamodb_table.deployments.name
      AWS_REG	             = var.aws_region
      COGNITO_USER_POOL_ID   = aws_cognito_user_pool.main.id
      COGNITO_REGION         = var.aws_region
      ALLOWED_CORS_ORIGINS   = join(",", var.cors_allowed_origins)
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda_api]
}
