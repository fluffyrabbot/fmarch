resource "cloudflare_dns_record" "frontend_v4" {
  zone_id = var.cloudflare_zone_id
  name    = local.frontend_host
  type    = "A"
  content = hcloud_load_balancer.public.ipv4
  proxied = true
  ttl     = 1
}

resource "cloudflare_dns_record" "frontend_v6" {
  zone_id = var.cloudflare_zone_id
  name    = local.frontend_host
  type    = "AAAA"
  content = hcloud_load_balancer.public.ipv6
  proxied = true
  ttl     = 1
}

resource "cloudflare_dns_record" "api_v4" {
  zone_id = var.cloudflare_zone_id
  name    = local.api_host
  type    = "A"
  content = hcloud_load_balancer.public.ipv4
  proxied = true
  ttl     = 1
}

resource "cloudflare_dns_record" "api_v6" {
  zone_id = var.cloudflare_zone_id
  name    = local.api_host
  type    = "AAAA"
  content = hcloud_load_balancer.public.ipv6
  proxied = true
  ttl     = 1
}
