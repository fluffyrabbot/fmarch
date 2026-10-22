locals {
  name = "fmarch-${var.environment}"

  # Cloudflare Universal SSL covers one wildcard level, so staging uses
  # sibling names instead of api.staging.<domain>.
  frontend_host = var.environment == "production" ? var.domain : "staging.${var.domain}"
  api_host      = var.environment == "production" ? "api.${var.domain}" : "api-staging.${var.domain}"

  network_cidr   = "10.40.0.0/16"
  subnet_cidr    = "10.40.1.0/24"
  public_lb_ip   = "10.40.1.5"
  internal_lb_ip = "10.40.1.6"
  app_ips        = ["10.40.1.11", "10.40.1.12"]
  db_ip          = "10.40.1.21"

  labels = {
    app         = "fmarch"
    environment = var.environment
  }

  b2_s3_endpoint = "https://s3.${var.b2_region}.backblazeb2.com"

  # Every bucket is locked (D6, D16). Only subject-journal keeps hidden
  # versions; everywhere else they are purged once the lock lapses so that
  # deletion, including crypto-shredding, completes within the window (D13).
  buckets = {
    media = {
      lock_days    = var.backup_lock_days
      purge_hidden = true
    }
    subject-journal = {
      lock_days    = var.journal_lock_days
      purge_hidden = false
    }
    subject-keys = {
      lock_days    = var.backup_lock_days
      purge_hidden = true
    }
    pgbackrest = {
      lock_days    = var.backup_lock_days
      purge_hidden = true
    }
  }

  # Writers never receive retention, legal-hold or governance-bypass
  # capabilities. subject-journal is create-only, so its writer cannot hide.
  bucket_writers = {
    api-media           = { bucket = "media", capabilities = ["listFiles", "readFiles", "writeFiles", "deleteFiles"] }
    api-subject-journal = { bucket = "subject-journal", capabilities = ["listFiles", "readFiles", "writeFiles"] }
    api-subject-keys    = { bucket = "subject-keys", capabilities = ["listFiles", "readFiles", "writeFiles", "deleteFiles"] }
    pgbackrest          = { bucket = "pgbackrest", capabilities = ["listFiles", "readFiles", "writeFiles", "deleteFiles"] }
  }
}
