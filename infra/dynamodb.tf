resource "aws_dynamodb_table" "deployments" {
  name         = "${local.name_prefix}-deployments"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "deployment_id"

  attribute {
    name = "deployment_id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}
