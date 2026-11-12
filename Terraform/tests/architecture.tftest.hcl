mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["us-east-1a", "us-east-1b"] }
  }
  mock_resource "aws_rds_cluster" {
    defaults = {
      arn                = "arn:aws:rds:us-east-1:123456789012:cluster:vialservi-aurora"
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:review", kms_key_id = "mock", secret_status = "active" }]
    }
  }
}
variables {
  aws_profile       = "vialservi-destino"
  target_account_id = "123456789012"
  jwt_secret        = "solo-prueba-local-000000000000000000000000000000"
  image_uri         = "123456789012.dkr.ecr.us-east-1.amazonaws.com/vialservi-api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
run "serverless_private_and_portable" {
  command = plan
  assert {
    condition     = aws_rds_cluster.app.serverlessv2_scaling_configuration[0].min_capacity == 0 && aws_rds_cluster.app.serverlessv2_scaling_configuration[0].max_capacity == 2
    error_message = "Aurora debe pausar a cero y limitarse a 2 ACU."
  }
  assert {
    condition     = aws_rds_cluster.app.deletion_protection && !aws_rds_cluster_instance.writer.publicly_accessible
    error_message = "Aurora debe ser privada y proteger sus datos."
  }
  assert {
    condition     = length(aws_security_group.database.ingress) == 0 && length(aws_lambda_function.api.vpc_config) == 0
    error_message = "Data API no necesita ingreso TCP ni Lambda en VPC."
  }
  assert {
    condition     = aws_lambda_function.api.environment[0].variables.OCR_MODO == "aws" && aws_lambda_function.api.timeout == 28
    error_message = "Conservar OCR y tiempo de espera de Lambda."
  }
  assert {
    condition     = alltrue([for policy in aws_s3_bucket_public_access_block.private : policy.block_public_policy && policy.restrict_public_buckets])
    error_message = "Todos los buckets deben permanecer privados."
  }
  assert {
    condition     = alltrue([for behavior in aws_cloudfront_distribution.app.ordered_cache_behavior : behavior.cache_policy_id == "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"])
    error_message = "El API no debe cachear sesiones ni respuestas privadas."
  }
}
run "reject_current_account" {
  command = plan
  variables { target_account_id = "102098709715" }
  expect_failures = [var.target_account_id]
}
run "reject_education_account" {
  command = plan
  variables { target_account_id = "497502378363" }
  expect_failures = [var.target_account_id]
}
