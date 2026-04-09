data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${local.name_prefix}-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "lambda_policy" {
  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:*:log-group:/aws/lambda/${local.name_prefix}-api",
      "arn:aws:logs:${var.aws_region}:*:log-group:/aws/lambda/${local.name_prefix}-api:*",
    ]
  }

  statement {
    sid = "DynamoDB"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
      "dynamodb:Scan",
      "dynamodb:Query",
    ]
    resources = [aws_dynamodb_table.deployments.arn]
  }

  statement {
    sid = "EC2Describe"
    actions = [
      "ec2:DescribeInstances",
    ]
    resources = ["*"]
  }

  statement {
    sid = "SSMRunCommand"
    actions = [
      "ssm:SendCommand",
      "ssm:GetCommandInvocation",
      "ssm:ListCommandInvocations",
      "ssm:ListCommands",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "lambda" {
  name   = "${local.name_prefix}-lambda-inline"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_policy.json
}
