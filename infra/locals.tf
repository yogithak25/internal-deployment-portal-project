locals {
  name_prefix = var.project_name
  issuer      = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}
