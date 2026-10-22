resource "hcloud_server" "app" {
  count = length(local.app_ips)

  name         = "${local.name}-app-${count.index + 1}"
  server_type  = var.app_server_type
  image        = var.image
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.operator.id]
  firewall_ids = [hcloud_firewall.operator_ssh.id]
  labels       = merge(local.labels, { role = "app" })

  # Templates receive only public, non-secret values. Secrets reach hosts
  # through Kamal secrets or infra/scripts/configure-db.sh, never user data.
  user_data = templatefile("${path.module}/cloud-init/app.yaml.tftpl", {
    ssh_public_key  = var.ssh_public_key
    debian_codename = var.debian_codename
  })

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  network {
    network_id = hcloud_network.main.id
    ip         = local.app_ips[count.index]
  }

  depends_on = [hcloud_network_subnet.main]

  lifecycle {
    ignore_changes = [user_data, ssh_keys, image]
  }
}

# PGDATA lives on a volume so a rebuilt DB host reattaches the same data.
resource "hcloud_volume" "pgdata" {
  name              = "${local.name}-pgdata"
  size              = var.db_volume_gb
  location          = var.location
  format            = "ext4"
  delete_protection = true
  labels            = merge(local.labels, { role = "pgdata" })

  lifecycle {
    prevent_destroy = true
  }
}

resource "hcloud_server" "db" {
  name         = "${local.name}-db-1"
  server_type  = var.db_server_type
  image        = var.image
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.operator.id]
  firewall_ids = [hcloud_firewall.operator_ssh.id]
  labels       = merge(local.labels, { role = "db" })

  user_data = templatefile("${path.module}/cloud-init/db.yaml.tftpl", {
    ssh_public_key  = var.ssh_public_key
    debian_codename = var.debian_codename
    volume_id       = hcloud_volume.pgdata.id
  })

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  network {
    network_id = hcloud_network.main.id
    ip         = local.db_ip
  }

  depends_on = [hcloud_network_subnet.main]

  lifecycle {
    ignore_changes = [user_data, ssh_keys, image]
  }
}

resource "hcloud_volume_attachment" "pgdata" {
  volume_id = hcloud_volume.pgdata.id
  server_id = hcloud_server.db.id
  automount = false
}
