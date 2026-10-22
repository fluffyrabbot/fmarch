variable "environment" {
  description = "Release environment this module builds."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "domain" {
  description = "Base domain served through Cloudflare, e.g. example.org."
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone id for var.domain."
  type        = string
}

variable "location" {
  description = "Hetzner location for the primary site (D1)."
  type        = string
  default     = "ash"
}

variable "network_zone" {
  description = "Hetzner network zone containing var.location."
  type        = string
  default     = "us-east"
}

variable "image" {
  description = "Hetzner OS image for every host."
  type        = string
  default     = "debian-13"
}

variable "debian_codename" {
  description = "Debian codename matching var.image, used for the PGDG and Docker apt sources."
  type        = string
  default     = "trixie"
}

variable "app_server_type" {
  description = "Hetzner server type for the two app hosts."
  type        = string
  default     = "cpx21"
}

variable "db_server_type" {
  description = "Hetzner server type for the PostgreSQL primary."
  type        = string
  default     = "cpx31"
}

variable "db_volume_gb" {
  description = "Size of the PGDATA volume in GB."
  type        = number
  default     = 40
}

variable "ssh_public_key" {
  description = "Operator SSH public key installed for the deploy user."
  type        = string
}

variable "operator_cidrs" {
  description = "CIDRs allowed to reach SSH on public interfaces."
  type        = list(string)

  validation {
    condition     = length(var.operator_cidrs) > 0 && !contains(var.operator_cidrs, "0.0.0.0/0") && !contains(var.operator_cidrs, "::/0")
    error_message = "operator_cidrs must name specific operator networks, never the whole internet."
  }
}

variable "bucket_prefix" {
  description = "Globally unique prefix for B2 bucket names."
  type        = string
}

variable "b2_region" {
  description = "B2 account region, e.g. us-west-004."
  type        = string
}

variable "journal_lock_days" {
  description = "Object Lock retention for subject-journal (D6): 35 in staging, 3650 in production."
  type        = number
}

variable "backup_lock_days" {
  description = "Object Lock retention for media, subject-keys and pgbackrest (D13, D16)."
  type        = number
  default     = 35
}

variable "database_authority_revision" {
  description = "FMARCH_DATABASE_AUTHORITY_REVISION for the migrator, e.g. staging-2026-10-21."
  type        = string
}

variable "db_shared_buffers" {
  description = "PostgreSQL shared_buffers, roughly a quarter of DB host memory."
  type        = string
  default     = "2GB"
}
