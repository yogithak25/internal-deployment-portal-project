resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "frontend" {
  bucket = "${local.name_prefix}-frontend-${random_id.bucket_suffix.hex}"
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${local.name_prefix}-oac"
  description                       = "OAC for frontend bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_iam_policy_document" "frontend_bucket" {
  statement {
    sid    = "AllowCloudFrontOAC"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.frontend.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket = aws_s3_bucket.frontend.id
  policy = data.aws_iam_policy_document.frontend_bucket.json
}

locals {
  use_custom_cert = var.acm_certificate_arn_us_east_1 != ""
  cf_aliases      = length(var.cloudfront_alias) > 0 ? var.cloudfront_alias : []
}

resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.name_prefix} SPA"
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class
  aliases             = local.use_custom_cert ? local.cf_aliases : []

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 86400
    max_ttl     = 31536000
  }

  custom_error_response {
    error_code         = 403
    response_code    = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code    = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !local.use_custom_cert
    acm_certificate_arn            = local.use_custom_cert ? var.acm_certificate_arn_us_east_1 : null
    ssl_support_method           = local.use_custom_cert ? "sni-only" : null
    minimum_protocol_version     = local.use_custom_cert ? "TLSv1.2_2021" : null
  }
}

# --- Optional: ACM in us-east-1 + Route 53 validation (placeholders) ---

resource "aws_acm_certificate" "portal" {
  count                     = var.create_acm_certificate && var.acm_domain_name != "" ? 1 : 0
  provider                  = aws.us_east_1
  domain_name               = var.acm_domain_name
  subject_alternative_names = []
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "acm_validation" {
  for_each = var.create_acm_certificate && var.route53_zone_id != "" && length(aws_acm_certificate.portal) > 0 ? {
    for dvo in aws_acm_certificate.portal[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
}

resource "aws_acm_certificate_validation" "portal" {
  count                   = var.create_acm_certificate && var.route53_zone_id != "" && length(aws_acm_certificate.portal) > 0 ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.portal[0].arn
  validation_record_fqdns = [for r in aws_route53_record.acm_validation : r.fqdn]
}

# Optional: map first CloudFront alias to distribution (requires ACM on the distribution).
resource "aws_route53_record" "portal_alias" {
  count   = var.route53_zone_id != "" && length(var.cloudfront_alias) > 0 && local.use_custom_cert ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.cloudfront_alias[0]
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}

