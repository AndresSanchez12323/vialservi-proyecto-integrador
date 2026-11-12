resource "aws_s3_bucket" "web" {
  bucket        = "${var.project}-web-${var.target_account_id}-${var.aws_region}"
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket" "evidence" {
  bucket        = "${var.project}-evidencias-${var.target_account_id}-${var.aws_region}"
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_public_access_block" "private" {
  for_each                = { web = aws_s3_bucket.web.id, evidence = aws_s3_bucket.evidence.id }
  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_ownership_controls" "private" {
  for_each = { web = aws_s3_bucket.web.id, evidence = aws_s3_bucket.evidence.id }
  bucket   = each.value
  rule { object_ownership = "BucketOwnerEnforced" }
}
resource "aws_s3_bucket_versioning" "private" {
  for_each = { web = aws_s3_bucket.web.id, evidence = aws_s3_bucket.evidence.id }
  bucket   = each.value
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "private" {
  for_each = { web = aws_s3_bucket.web.id, evidence = aws_s3_bucket.evidence.id }
  bucket   = each.value
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_cors_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  cors_rule {
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = ["https://${aws_cloudfront_distribution.app.domain_name}"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}
resource "aws_s3_bucket_lifecycle_configuration" "evidence" {
  bucket     = aws_s3_bucket.evidence.id
  depends_on = [aws_s3_bucket_versioning.private]
  rule {
    id     = "historico-a-los-dos-anos"
    status = "Enabled"
    filter { prefix = "" }
    transition {
      days          = 730
      storage_class = "STANDARD_IA"
    }
  }
  rule {
    id     = "ocr-tarjetas-un-dia"
    status = "Enabled"
    filter { prefix = "ocr-tarjetas/" }
    expiration { days = 1 }
    noncurrent_version_expiration { noncurrent_days = 1 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}
resource "aws_s3_bucket_policy" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Sid       = "RequireTLS", Effect = "Deny", Principal = "*", Action = "s3:*",
    Resource  = [aws_s3_bucket.evidence.arn, "${aws_s3_bucket.evidence.arn}/*"],
    Condition = { Bool = { "aws:SecureTransport" = "false" } }
  }] })
}
