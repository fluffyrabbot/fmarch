resource "b2_bucket" "this" {
  for_each = local.buckets

  bucket_name = "${var.bucket_prefix}-${var.environment}-${each.key}"
  bucket_type = "allPrivate"

  default_server_side_encryption {
    mode      = "SSE-B2"
    algorithm = "AES256"
  }

  file_lock_configuration {
    is_file_lock_enabled = true

    default_retention {
      mode = "compliance"

      period {
        duration = each.value.lock_days
        unit     = "days"
      }
    }
  }

  dynamic "lifecycle_rules" {
    for_each = each.value.purge_hidden ? [1] : []

    content {
      file_name_prefix             = ""
      days_from_hiding_to_deleting = 1
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "b2_application_key" "writer" {
  for_each = local.bucket_writers

  key_name     = "${local.name}-${each.key}"
  bucket_id    = b2_bucket.this[each.value.bucket].bucket_id
  capabilities = each.value.capabilities
}

# Read-only keys for the nightly fluffycachy pull copy (D16).
resource "b2_application_key" "pull" {
  for_each = local.buckets

  key_name     = "${local.name}-pull-${each.key}"
  bucket_id    = b2_bucket.this[each.key].bucket_id
  capabilities = ["listFiles", "readFiles"]
}
