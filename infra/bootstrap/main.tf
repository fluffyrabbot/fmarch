# One-time root that creates the B2 bucket holding every environment's
# OpenTofu state. Its own state is local, encrypted, and kept outside the
# repository at var.bootstrap_state_path.
terraform {
  required_version = ">= 1.10"

  required_providers {
    b2 = { source = "Backblaze/b2", version = "~> 0.10" }
  }

  backend "local" {
    path = var.bootstrap_state_path
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

variable "bootstrap_state_path" {
  description = "Absolute path for this root's local state, e.g. ~/secure/fmarch/tofu-bootstrap.tfstate expanded."
  type        = string
}

variable "state_passphrase" {
  type      = string
  sensitive = true
}

variable "bucket_prefix" {
  type = string
}

provider "b2" {}

# B2 keeps every version, so earlier state remains recoverable. Hidden
# versions are kept for 90 days.
resource "b2_bucket" "state" {
  bucket_name = "${var.bucket_prefix}-tofu-state"
  bucket_type = "allPrivate"

  default_server_side_encryption {
    mode      = "SSE-B2"
    algorithm = "AES256"
  }

  lifecycle_rules {
    file_name_prefix             = ""
    days_from_hiding_to_deleting = 90
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "b2_application_key" "state" {
  key_name     = "${var.bucket_prefix}-tofu-state"
  bucket_id    = b2_bucket.state.bucket_id
  capabilities = ["listBuckets", "listFiles", "readFiles", "writeFiles", "deleteFiles"]
}

output "state_bucket" {
  value = b2_bucket.state.bucket_name
}

output "state_key" {
  value = {
    key_id = b2_application_key.state.application_key_id
    secret = b2_application_key.state.application_key
  }
  sensitive = true
}
