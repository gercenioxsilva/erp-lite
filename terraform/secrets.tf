# ── Auto-generated secrets ─────────────────────────────────────────────────────
# Passwords are generated once, stored in the encrypted S3 Terraform state,
# and never need to be passed as GitHub secrets.
#
# To retrieve the DB password after deploy:
#   terraform output -raw db_password

resource "random_password" "db_master" {
  length  = 32
  special = true
  # Must exclude:
  #   RDS rejects     → @  /  "  (space)
  #   URL-breaking    → :  #  %  ?  &  =  +  [  ]
  # Remaining safe subset that works in both RDS and a postgres:// URL.
  override_special = "!^*()-_{}~"
}

output "db_password" {
  description = "RDS master password (retrieve from Terraform state — never logged)"
  value       = random_password.db_master.result
  sensitive   = true
}
