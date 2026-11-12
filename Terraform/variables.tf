variable "aws_profile" {
  type        = string
  description = "Perfil EXPLICITO de la nueva cuenta; nunca default/personal/AndresX."
  validation {
    condition     = !contains(["default", "personal", "andresx", ""], lower(var.aws_profile))
    error_message = "Cree un perfil exclusivo para la cuenta destino."
  }
}
variable "aws_region" {
  type    = string
  default = "us-east-1"
  validation {
    condition     = var.aws_region == "us-east-1"
    error_message = "Este montaje esta preparado para us-east-1."
  }
}
variable "target_account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.target_account_id)) && !contains(["102098709715", "497502378363"], var.target_account_id)
    error_message = "Indique una cuenta nueva, distinta de la personal y la educativa."
  }
}
variable "project" {
  type    = string
  default = "vialservi"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,24}$", var.project))
    error_message = "Use 3 a 25 caracteres: minusculas, numeros y guion."
  }
}
variable "source_commit" {
  type        = string
  default     = "bc72221eb6edc7e980ea90cc340a3eb5c5661a16"
  description = "Version de main tomada como base; actualizar deliberadamente junto con la imagen."
  validation {
    condition     = can(regex("^[a-f0-9]{40}$", var.source_commit))
    error_message = "Se requiere el SHA completo del codigo publicado."
  }
}
variable "image_uri" {
  type        = string
  description = "Imagen ECR de la cuenta destino fijada por digest sha256, no latest."
  validation {
    condition     = can(regex("^[0-9]{12}\\.dkr\\.ecr\\.us-east-1\\.amazonaws\\.com/[a-z0-9-]+@sha256:[a-f0-9]{64}$", var.image_uri))
    error_message = "Debe usar una URI ECR inmutable de us-east-1."
  }
}
variable "engine_version" {
  type    = string
  default = "16.15"
}
variable "snapshot_identifier" {
  type        = string
  default     = null
  description = "Snapshot COPIADO a destino con KMS de destino. null crea una base vacia."
}
variable "jwt_secret" {
  type        = string
  sensitive   = true
  ephemeral   = true
  description = "TF_VAR_jwt_secret: no se guarda en plan/state gracias a value_wo."
  validation {
    condition     = length(var.jwt_secret) >= 32
    error_message = "JWT requiere al menos 32 caracteres aleatorios."
  }
}
variable "smtp_password" {
  type      = string
  sensitive = true
  ephemeral = true
  default   = "sin-configurar"
  validation {
    condition     = var.mail_mode != "smtp" || (length(var.smtp_password) >= 8 && var.smtp_password != "sin-configurar")
    error_message = "SMTP requiere una clave real por TF_VAR_smtp_password."
  }
}
variable "secret_version" {
  type        = number
  default     = 1
  description = "Incrementar solo para rotar deliberadamente JWT/SMTP."
}
variable "mail_mode" {
  type    = string
  default = "consola"
  validation {
    condition     = contains(["consola", "smtp", "ses"], var.mail_mode)
    error_message = "Use consola, smtp o ses."
  }
}
variable "mail_sender" {
  type    = string
  default = "no-responde@vialservi.co"
}
variable "smtp_host" {
  type    = string
  default = ""
}
variable "smtp_port" {
  type    = number
  default = 587
}
variable "smtp_user" {
  type    = string
  default = ""
}
variable "ses_email_identity" {
  type        = string
  default     = null
  description = "Correo a verificar en SES; el propietario debe aceptar el mensaje."
}
