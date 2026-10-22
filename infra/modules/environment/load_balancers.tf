# Public path (D10): Cloudflare -> HTTPS on this LB -> kamal-proxy :80 on
# each app host over the private network.
resource "hcloud_load_balancer" "public" {
  name               = "${local.name}-public"
  load_balancer_type = "lb11"
  location           = var.location
  labels             = local.labels
}

resource "hcloud_load_balancer_network" "public" {
  load_balancer_id = hcloud_load_balancer.public.id
  subnet_id        = hcloud_network_subnet.main.id
  ip               = local.public_lb_ip
}

resource "hcloud_load_balancer_target" "public" {
  count = length(hcloud_server.app)

  type             = "server"
  load_balancer_id = hcloud_load_balancer.public.id
  server_id        = hcloud_server.app[count.index].id
  use_private_ip   = true

  depends_on = [hcloud_load_balancer_network.public]
}

resource "hcloud_uploaded_certificate" "origin" {
  name        = "${local.name}-origin"
  private_key = tls_private_key.origin.private_key_pem
  certificate = cloudflare_origin_ca_certificate.origin.certificate
  labels      = local.labels
}

resource "hcloud_load_balancer_service" "https" {
  load_balancer_id = hcloud_load_balancer.public.id
  protocol         = "https"
  listen_port      = 443
  destination_port = 80
  proxyprotocol    = false

  http {
    certificates    = [hcloud_uploaded_certificate.origin.id]
    redirect_http   = true
    sticky_sessions = false
  }

  health_check {
    protocol = "http"
    port     = 80
    interval = 10
    timeout  = 5
    retries  = 3

    http {
      domain       = local.api_host
      path         = "/readyz"
      status_codes = ["200"]
    }
  }
}

# Private path (D15): the frontend's server-side calls reach the API here.
# The public interface is disabled, so nothing outside the private network
# can speak plain HTTP to the API.
resource "hcloud_load_balancer" "internal" {
  name               = "${local.name}-internal"
  load_balancer_type = "lb11"
  location           = var.location
  labels             = local.labels
}

resource "hcloud_load_balancer_network" "internal" {
  load_balancer_id        = hcloud_load_balancer.internal.id
  subnet_id               = hcloud_network_subnet.main.id
  ip                      = local.internal_lb_ip
  enable_public_interface = false
}

resource "hcloud_load_balancer_target" "internal" {
  count = length(hcloud_server.app)

  type             = "server"
  load_balancer_id = hcloud_load_balancer.internal.id
  server_id        = hcloud_server.app[count.index].id
  use_private_ip   = true

  depends_on = [hcloud_load_balancer_network.internal]
}

resource "hcloud_load_balancer_service" "internal_http" {
  load_balancer_id = hcloud_load_balancer.internal.id
  protocol         = "http"
  listen_port      = 80
  destination_port = 80
  proxyprotocol    = false

  health_check {
    protocol = "http"
    port     = 80
    interval = 10
    timeout  = 5
    retries  = 3

    http {
      domain       = local.internal_lb_ip
      path         = "/readyz"
      status_codes = ["200"]
    }
  }
}
