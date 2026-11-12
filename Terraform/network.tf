resource "aws_vpc" "app" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.project}-vpc" }
}
resource "aws_subnet" "database" {
  count                   = 2
  vpc_id                  = aws_vpc.app.id
  cidr_block              = cidrsubnet(aws_vpc.app.cidr_block, 8, count.index + 10)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${var.project}-db-${count.index + 1}" }
}
resource "aws_route_table" "database" {
  vpc_id = aws_vpc.app.id
  tags   = { Name = "${var.project}-db-aislada" }
}
resource "aws_route_table_association" "database" {
  count          = 2
  subnet_id      = aws_subnet.database[count.index].id
  route_table_id = aws_route_table.database.id
}
resource "aws_security_group" "database" {
  name        = "${var.project}-aurora"
  description = "Sin ingreso TCP; solo Data API"
  vpc_id      = aws_vpc.app.id
  ingress     = []
  egress      = []
  # Sin reglas de entrada ni salida, NAT, Internet Gateway o proxy.
}
resource "aws_db_subnet_group" "database" {
  name       = "${var.project}-aurora"
  subnet_ids = aws_subnet.database[*].id
}
