resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${var.project}-api"
  retention_in_days = 14
}
resource "aws_iam_role" "api" {
  name = "${var.project}-lambda"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
}
resource "aws_iam_role_policy" "api" {
  role = aws_iam_role.api.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Deny", Action = "s3:*", Resource = "${aws_s3_bucket.evidence.arn}/migracion-aurora/*" },
    { Effect = "Allow", Action = ["rds-data:ExecuteStatement", "rds-data:BatchExecuteStatement", "rds-data:BeginTransaction", "rds-data:CommitTransaction", "rds-data:RollbackTransaction"], Resource = aws_rds_cluster.app.arn },
    { Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = aws_rds_cluster.app.master_user_secret[0].secret_arn },
    { Effect = "Allow", Action = "ssm:GetParameters", Resource = [aws_ssm_parameter.jwt.arn, aws_ssm_parameter.smtp.arn] },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "${aws_s3_bucket.evidence.arn}/*" },
    { Effect = "Allow", Action = ["s3:GetObjectVersion", "s3:DeleteObject", "s3:DeleteObjectVersion"], Resource = "${aws_s3_bucket.evidence.arn}/ocr-tarjetas/*" },
    { Effect = "Allow", Action = "textract:DetectDocumentText", Resource = "*" },
    { Effect = "Allow", Action = "ses:SendEmail", Resource = "${local.prefix}:ses:${var.aws_region}:${var.target_account_id}:identity/*" },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.api.arn}:*" }
  ] })
}
resource "aws_lambda_function" "api" {
  function_name = "${var.project}-api"
  role          = aws_iam_role.api.arn
  package_type  = "Image"
  image_uri     = var.image_uri
  architectures = ["x86_64"]
  memory_size   = 512
  timeout       = 28
  depends_on    = [aws_iam_role_policy.api, aws_rds_cluster_instance.writer]
  environment {
    variables = {
      NODE_ENV              = "production"
      BASE_MODO             = "data-api"
      DATABASE_URL          = "postgresql://unused:unused@localhost/vialservi"
      AURORA_CLUSTER_ARN    = aws_rds_cluster.app.arn
      AURORA_SECRET_ARN     = aws_rds_cluster.app.master_user_secret[0].secret_arn
      AURORA_DATABASE       = "vialservi"
      SSM_PREFIJO           = local.ssm_prefix
      ALMACENAMIENTO_MODO   = "s3"
      OCR_MODO              = "aws"
      S3_BUCKET_EVIDENCIAS  = aws_s3_bucket.evidence.id
      CORREO_MODO           = var.mail_mode
      CORREO_REMITENTE      = var.mail_sender
      SMTP_HOST             = var.smtp_host
      SMTP_PUERTO           = tostring(var.smtp_port)
      SMTP_USUARIO          = var.smtp_user
      CORREO_REVELAR_CODIGO = "false"
      CORS_ORIGIN           = "https://${aws_cloudfront_distribution.app.domain_name}"
    }
  }
  lifecycle {
    precondition {
      condition     = startswith(var.image_uri, "${var.target_account_id}.dkr.ecr.${var.aws_region}.amazonaws.com/")
      error_message = "La imagen debe pertenecer a la nueva cuenta."
    }
    precondition {
      condition     = var.mail_mode != "smtp" || (var.smtp_host != "" && var.smtp_user != "")
      error_message = "SMTP requiere host y usuario, ademas de TF_VAR_smtp_password."
    }
  }
}
resource "aws_apigatewayv2_api" "app" {
  name          = "${var.project}-serverless"
  protocol_type = "HTTP"
}
resource "aws_apigatewayv2_integration" "app" {
  api_id                 = aws_apigatewayv2_api.app.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 29000
}
resource "aws_apigatewayv2_route" "app" {
  api_id    = aws_apigatewayv2_api.app.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.app.id}"
}
resource "aws_apigatewayv2_stage" "app" {
  api_id      = aws_apigatewayv2_api.app.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }
}
resource "aws_lambda_permission" "gateway" {
  statement_id  = "InvokeFromHTTPAPI"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.app.execution_arn}/*/*"
}
resource "aws_ses_email_identity" "sender" {
  count = var.ses_email_identity == null ? 0 : 1
  email = var.ses_email_identity
}
