resource "aws_db_subnet_group" "main" {
  name       = "erp-lite-db-${var.environment}"
  subnet_ids = aws_subnet.private[*].id
  tags       = { Environment = var.environment }
}

resource "aws_db_instance" "postgres" {
  identifier     = "erp-lite-postgres-${var.environment}"
  engine         = "postgres"
  engine_version = "16.4"
  instance_class = var.db_instance_class

  # Storage — gp3 is cheaper than gp2 for small databases
  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "erp_lite"
  username = "erp_lite"
  password = random_password.db_master.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  # Cost optimisation
  multi_az            = var.environment == "prod" # HA only in prod
  publicly_accessible = false

  # Backups
  backup_retention_period    = var.environment == "prod" ? 7 : 1
  backup_window              = "03:00-04:00"
  maintenance_window         = "sun:04:00-sun:05:00"
  auto_minor_version_upgrade = true

  # Safety
  deletion_protection       = var.environment == "prod"
  skip_final_snapshot       = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "erp-lite-final-snapshot" : null

  # Performance Insights (free tier: 7 days)
  performance_insights_enabled          = true
  performance_insights_retention_period = 7

  tags = { Environment = var.environment }
}
