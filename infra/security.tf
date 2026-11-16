resource "aws_security_group" "polo" {
  name_prefix = "${lower(var.project_name)}-"
  description = "Polo server access"
  vpc_id      = aws_vpc.polo.id

  tags = {
    Name = "${var.project_name}-security-group"
  }
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id = aws_security_group.polo.id
  description       = "SSH from the administrator public IP"
  cidr_ipv4         = var.ssh_allowed_cidr
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
}

resource "aws_vpc_security_group_ingress_rule" "web" {
  for_each = {
    http  = 80
    https = 443
  }

  security_group_id = aws_security_group.polo.id
  description       = "Public ${each.key} access"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = each.value
  to_port           = each.value
}

resource "aws_vpc_security_group_egress_rule" "outbound" {
  security_group_id = aws_security_group.polo.id
  description       = "Outbound access for probes and package downloads"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
