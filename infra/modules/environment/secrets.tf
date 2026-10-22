# Generated database authority. Values live only in encrypted state and in
# the files configure-db.sh writes on the DB host.
resource "random_password" "db_owner" {
  length  = 48
  special = false
}

resource "random_password" "db_application" {
  length  = 48
  special = false
}

resource "random_password" "db_key_admin" {
  length  = 48
  special = false
}

resource "random_password" "pgbackrest_cipher" {
  length  = 64
  special = false
}

# D12: platform-neutral database target identity.
resource "random_uuid" "database_instance" {}
