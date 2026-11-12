resource "aws_rds_cluster" "app" {
  cluster_identifier          = "${var.project}-aurora"
  engine                      = "aurora-postgresql"
  engine_mode                 = "provisioned"
  engine_version              = var.engine_version
  database_name               = var.snapshot_identifier == null ? "vialservi" : null
  master_username             = var.snapshot_identifier == null ? "vialservi" : null
  manage_master_user_password = true
  snapshot_identifier         = var.snapshot_identifier
  db_subnet_group_name        = aws_db_subnet_group.database.name
  vpc_security_group_ids      = [aws_security_group.database.id]
  storage_encrypted           = true
  kms_key_id                  = aws_kms_key.data.arn
  enable_http_endpoint        = true
  backup_retention_period     = 7
  deletion_protection         = true
  skip_final_snapshot         = false
  final_snapshot_identifier   = "${var.project}-final-conservar"
  serverlessv2_scaling_configuration {
    min_capacity             = 0
    max_capacity             = 2
    seconds_until_auto_pause = 300
  }
  lifecycle { prevent_destroy = true }
}
resource "aws_rds_cluster_instance" "writer" {
  identifier                 = "${var.project}-aurora-escritor"
  cluster_identifier         = aws_rds_cluster.app.id
  instance_class             = "db.serverless"
  engine                     = aws_rds_cluster.app.engine
  engine_version             = aws_rds_cluster.app.engine_version
  publicly_accessible        = false
  auto_minor_version_upgrade = true
}

resource "aws_kms_key" "data" {
  description             = "${var.project}: Aurora y copias transferibles"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  lifecycle { prevent_destroy = true }
}
resource "aws_kms_alias" "data" {
  name          = "alias/${var.project}-datos"
  target_key_id = aws_kms_key.data.key_id
}
resource "aws_ssm_parameter" "jwt" {
  name             = "${local.ssm_prefix}/JWT_SECRET"
  type             = "SecureString"
  value_wo         = var.jwt_secret
  value_wo_version = var.secret_version
  lifecycle { prevent_destroy = true }
}
resource "aws_ssm_parameter" "smtp" {
  name             = "${local.ssm_prefix}/SMTP_CLAVE"
  type             = "SecureString"
  value_wo         = var.smtp_password
  value_wo_version = var.secret_version
  lifecycle { prevent_destroy = true }
}
