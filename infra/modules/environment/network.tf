resource "hcloud_ssh_key" "operator" {
  name       = "${local.name}-operator"
  public_key = var.ssh_public_key
  labels     = local.labels
}

resource "hcloud_network" "main" {
  name     = local.name
  ip_range = local.network_cidr
  labels   = local.labels
}

resource "hcloud_network_subnet" "main" {
  network_id   = hcloud_network.main.id
  type         = "cloud"
  network_zone = var.network_zone
  ip_range     = local.subnet_cidr
}

# Hetzner firewalls filter public interfaces only. Load balancers reach
# kamal-proxy and app hosts reach PostgreSQL over the private network, so the
# public surface is SSH from the operator and nothing else.
resource "hcloud_firewall" "operator_ssh" {
  name   = "${local.name}-operator-ssh"
  labels = local.labels

  rule {
    description = "Operator SSH"
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = var.operator_cidrs
  }
}
