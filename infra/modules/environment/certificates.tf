# Per-environment PostgreSQL CA. Clients use sslmode=verify-full against it.
# Rerunning `tofu apply` within early_renewal_hours of expiry replaces the
# server certificate; configure-db.sh then installs it.
resource "tls_private_key" "pg_ca" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "tls_self_signed_cert" "pg_ca" {
  private_key_pem       = tls_private_key.pg_ca.private_key_pem
  is_ca_certificate     = true
  validity_period_hours = 24 * 365 * 5
  allowed_uses          = ["cert_signing", "crl_signing"]

  subject {
    common_name  = "${local.name} postgres CA"
    organization = "fmarch"
  }
}

resource "tls_private_key" "pg_server" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "tls_cert_request" "pg_server" {
  private_key_pem = tls_private_key.pg_server.private_key_pem
  ip_addresses    = [local.db_ip]
  dns_names       = ["db.${var.environment}.fmarch.internal"]

  subject {
    common_name  = local.db_ip
    organization = "fmarch"
  }
}

resource "tls_locally_signed_cert" "pg_server" {
  cert_request_pem      = tls_cert_request.pg_server.cert_request_pem
  ca_private_key_pem    = tls_private_key.pg_ca.private_key_pem
  ca_cert_pem           = tls_self_signed_cert.pg_ca.cert_pem
  validity_period_hours = 24 * 365
  early_renewal_hours   = 24 * 30
  allowed_uses          = ["digital_signature", "key_encipherment", "server_auth"]
}

# Cloudflare Origin CA certificate for the public load balancer (Full strict).
resource "tls_private_key" "origin" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "tls_cert_request" "origin" {
  private_key_pem = tls_private_key.origin.private_key_pem
  dns_names       = [local.frontend_host, local.api_host]

  subject {
    common_name = local.frontend_host
  }
}

resource "cloudflare_origin_ca_certificate" "origin" {
  csr                = tls_cert_request.origin.cert_request_pem
  hostnames          = [local.frontend_host, local.api_host]
  request_type       = "origin-ecc"
  requested_validity = 5475
}
