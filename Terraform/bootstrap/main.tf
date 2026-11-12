terraform {
  required_version = ">= 1.11, < 2.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}
variable "aws_profile" { type = string }
variable "target_account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.target_account_id)) && !contains(["102098709715", "497502378363"], var.target_account_id)
    error_message = "Solo una cuenta nueva, nunca las cuentas actuales."
  }
}
variable "aws_region" {
  type    = string
  default = "us-east-1"
}
variable "project" {
  type    = string
  default = "vialservi"
}
provider "aws" {
  profile             = var.aws_profile
  region              = var.aws_region
  allowed_account_ids = [var.target_account_id]
  default_tags { tags = { Project = var.project, ManagedBy = "Terraform" } }
}
resource "aws_ecr_repository" "api" {
  name                 = "${var.project}-api"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
  lifecycle { prevent_destroy = true }
}
resource "aws_ecr_repository_policy" "lambda" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Sid       = "LambdaImageRetrieval", Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" },
    Action    = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
    Condition = { ArnLike = { "aws:SourceArn" = "arn:aws:lambda:${var.aws_region}:${var.target_account_id}:function:${var.project}-*" } }
  }] })
}
resource "aws_s3_bucket" "state" {
  bucket        = "${var.project}-tfstate-${var.target_account_id}-${var.aws_region}"
  force_destroy = false
  lifecycle { prevent_destroy = true }
}
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect    = "Deny", Principal = "*", Action = "s3:*",
    Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"],
    Condition = { Bool = { "aws:SecureTransport" = "false" } }
  }] })
}
output "repository_url" { value = aws_ecr_repository.api.repository_url }
output "state_bucket" { value = aws_s3_bucket.state.id }

resource "aws_kms_key" "transfer" {
  description             = "Copias de snapshots recibidas por la nueva cuenta"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  lifecycle { prevent_destroy = true }
}
resource "aws_kms_alias" "transfer" {
  name          = "alias/${var.project}-transferencia"
  target_key_id = aws_kms_key.transfer.key_id
}
output "snapshot_copy_kms_arn" { value = aws_kms_key.transfer.arn }

