terraform {
  required_version = ">= 1.10"

  required_providers {
    hcloud     = { source = "hetznercloud/hcloud", version = "~> 1.52" }
    b2         = { source = "Backblaze/b2", version = "~> 0.10" }
    aws        = { source = "hashicorp/aws", version = "~> 6.0" }
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 5.0" }
  }

  # State is in B2 (created by infra/bootstrap) and encrypted client-side
  # before upload (D9). Backend values come from early-evaluated variables.
  backend "s3" {
    bucket                      = var.state_bucket
    key                         = "staging/terraform.tfstate"
    region                      = var.state_b2_region
    endpoints                   = { s3 = "https://s3.${var.state_b2_region}.backblazeb2.com" }
    access_key                  = var.state_b2_key_id
    secret_key                  = var.state_b2_key
    use_path_style              = true
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }

  encryption {
    key_provider "pbkdf2" "operator" {
      passphrase = var.state_passphrase
    }

    method "aes_gcm" "operator" {
      keys = key_provider.pbkdf2.operator
    }

    state {
      method   = method.aes_gcm.operator
      enforced = true
    }

    plan {
      method   = method.aes_gcm.operator
      enforced = true
    }
  }
}

variable "state_bucket" {
  type = string
}

variable "state_b2_region" {
  type = string
}

variable "state_b2_key_id" {
  type      = string
  sensitive = true
}

variable "state_b2_key" {
  type      = string
  sensitive = true
}

variable "state_passphrase" {
  type      = string
  sensitive = true
}

variable "domain" {
  type = string
}

variable "cloudflare_zone_id" {
  type = string
}

variable "ssh_public_key" {
  type = string
}

variable "operator_cidrs" {
  type = list(string)
}

variable "bucket_prefix" {
  type = string
}

variable "b2_region" {
  type = string
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "database_authority_revision" {
  type = string
}

# Credentials come from the environment: HCLOUD_TOKEN, B2_APPLICATION_KEY_ID
# and B2_APPLICATION_KEY, AWS_PROFILE, CLOUDFLARE_API_TOKEN.
provider "hcloud" {}

provider "b2" {}

provider "aws" {
  region = var.aws_region
}

provider "cloudflare" {}

module "environment" {
  source = "../../modules/environment"

  environment                 = "staging"
  domain                      = var.domain
  cloudflare_zone_id          = var.cloudflare_zone_id
  ssh_public_key              = var.ssh_public_key
  operator_cidrs              = var.operator_cidrs
  bucket_prefix               = var.bucket_prefix
  b2_region                   = var.b2_region
  journal_lock_days           = 35
  database_authority_revision = var.database_authority_revision

  # D11: production's multi-node shape, smaller DB host, no standby.
  app_server_type   = "cpx21"
  db_server_type    = "cpx21"
  db_volume_gb      = 20
  db_shared_buffers = "1GB"
}

output "environment" {
  value     = module.environment
  sensitive = true
}
