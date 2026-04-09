provider "aws" {
  region = var.aws_region
}

# Optional: ACM for CloudFront must live in us-east-1
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}
