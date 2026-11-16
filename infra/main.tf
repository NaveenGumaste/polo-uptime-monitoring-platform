data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"]

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

resource "aws_key_pair" "polo" {
  key_name_prefix = "${lower(var.project_name)}-"
  public_key      = trimspace(file(pathexpand(var.ssh_public_key_path)))

  tags = {
    Name = "${var.project_name}-ssh-key"
  }
}

resource "aws_instance" "polo" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  associate_public_ip_address = true
  vpc_security_group_ids      = [aws_security_group.polo.id]
  key_name                    = aws_key_pair.polo.key_name
  iam_instance_profile        = aws_iam_instance_profile.polo.name

  user_data = replace(
    file("${path.module}/user-data.sh"),
    "\r\n",
    "\n"
  )
  user_data_replace_on_change = true

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 30
    encrypted             = true
    delete_on_termination = true
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  credit_specification {
    cpu_credits = "standard"
  }

  tags = {
    Name = "${var.project_name}-server"
  }

  depends_on = [
    aws_route_table_association.public,
    aws_vpc_security_group_egress_rule.outbound,
    aws_iam_role_policy_attachment.ssm
  ]
}
