terraform {
  required_version = ">= 1.11.0, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
  backend "s3" {}
}

provider "aws" {
  profile             = var.aws_profile
  region              = var.aws_region
  allowed_account_ids = [var.target_account_id]
  default_tags {
    tags = { Project = var.project, ManagedBy = "Terraform", SourceCommit = var.source_commit }
  }
}

data "aws_caller_identity" "target" {}
data "aws_partition" "current" {}
data "aws_availability_zones" "available" { state = "available" }

locals {
  prefix     = "arn:${data.aws_partition.current.partition}"
  ssm_prefix = "/${var.project}"
}
