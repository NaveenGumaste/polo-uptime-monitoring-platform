output "instance_id" {
  description = "ID of the Polo EC2 instance."
  value       = aws_instance.polo.id
}

output "public_ip" {
  description = "Public IPv4 address of the Polo server."
  value       = aws_instance.polo.public_ip
}

output "public_dns" {
  description = "Public DNS hostname of the Polo server."
  value       = aws_instance.polo.public_dns
}

output "ssh_command" {
  description = "Command to connect using the corresponding private key."
  value = format(
    "ssh -i \"%s\" ubuntu@%s",
    trimsuffix(pathexpand(var.ssh_public_key_path), ".pub"),
    aws_instance.polo.public_ip
  )
}
