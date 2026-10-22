# D7: the subject-authority wrapping key exists in plaintext only in the
# operator's escrow. infra/scripts/wrap-authority-key.sh encrypts it under
# this key with an environment-bound encryption context, and the API
# decrypts it at startup with the IP-pinned, decrypt-only credential below.
resource "aws_kms_key" "subject_authority" {
  description              = "${local.name} subject-authority wrapping key"
  key_usage                = "ENCRYPT_DECRYPT"
  customer_master_key_spec = "SYMMETRIC_DEFAULT"
  deletion_window_in_days  = 30
  enable_key_rotation      = true
  tags                     = local.labels

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "subject_authority" {
  name          = "alias/${local.name}-subject-authority"
  target_key_id = aws_kms_key.subject_authority.key_id
}

resource "aws_iam_user" "api" {
  name = "${local.name}-api"
  tags = local.labels
}

resource "aws_iam_user_policy" "api_decrypt" {
  name = "${local.name}-subject-authority-decrypt"
  user = aws_iam_user.api.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "DecryptSubjectAuthorityWrapKeyFromAppHosts"
      Effect   = "Allow"
      Action   = ["kms:Decrypt"]
      Resource = aws_kms_key.subject_authority.arn
      Condition = {
        IpAddress = {
          "aws:SourceIp" = concat(
            [for server in hcloud_server.app : "${server.ipv4_address}/32"],
            [for server in hcloud_server.app : server.ipv6_network],
          )
        }
        StringEquals = {
          "kms:EncryptionContext:fmarch:environment" = var.environment
          "kms:EncryptionContext:fmarch:purpose"     = "subject-authority-wrap"
        }
      }
    }]
  })
}

resource "aws_iam_access_key" "api" {
  user = aws_iam_user.api.name
}
