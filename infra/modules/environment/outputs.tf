output "environment" {
  value = var.environment
}

output "frontend_host" {
  value = local.frontend_host
}

output "api_host" {
  value = local.api_host
}

output "app_hosts" {
  description = "App hosts for Kamal: public IPv4 for SSH, private IP for traffic."
  value = [for index, server in hcloud_server.app : {
    name        = server.name
    public_ipv4 = server.ipv4_address
    private_ip  = local.app_ips[index]
  }]
}

output "db_host" {
  value = {
    name        = hcloud_server.db.name
    public_ipv4 = hcloud_server.db.ipv4_address
    private_ip  = local.db_ip
    volume_id   = hcloud_volume.pgdata.id
  }
}

output "subnet_cidr" {
  value = local.subnet_cidr
}

output "internal_api_url" {
  description = "FMARCH_API_INTERNAL_URL for the frontend (D15)."
  value       = "http://${local.internal_lb_ip}"
}

output "public_lb" {
  value = {
    ipv4 = hcloud_load_balancer.public.ipv4
    ipv6 = hcloud_load_balancer.public.ipv6
  }
}

output "b2_s3_endpoint" {
  value = local.b2_s3_endpoint
}

output "b2_region" {
  value = var.b2_region
}

output "buckets" {
  value = { for name, bucket in b2_bucket.this : name => bucket.bucket_name }
}

output "bucket_writer_keys" {
  value = { for name, key in b2_application_key.writer : name => {
    key_id = key.application_key_id
    secret = key.application_key
  } }
  sensitive = true
}

output "bucket_pull_keys" {
  value = { for name, key in b2_application_key.pull : name => {
    key_id = key.application_key_id
    secret = key.application_key
  } }
  sensitive = true
}

output "kms_key_arn" {
  value = aws_kms_key.subject_authority.arn
}

output "kms_decrypt_credential" {
  value = {
    access_key_id     = aws_iam_access_key.api.id
    secret_access_key = aws_iam_access_key.api.secret
  }
  sensitive = true
}

output "pg_ca_cert" {
  value = tls_self_signed_cert.pg_ca.cert_pem
}

output "pg_server_tls" {
  value = {
    cert = tls_locally_signed_cert.pg_server.cert_pem
    key  = tls_private_key.pg_server.private_key_pem
  }
  sensitive = true
}

output "database_authority" {
  value = {
    instance_id        = random_uuid.database_instance.result
    revision           = var.database_authority_revision
    owner_password     = random_password.db_owner.result
    application_secret = random_password.db_application.result
    key_admin_secret   = random_password.db_key_admin.result
  }
  sensitive = true
}

output "pgbackrest_cipher_pass" {
  value     = random_password.pgbackrest_cipher.result
  sensitive = true
}

output "db_shared_buffers" {
  value = var.db_shared_buffers
}
