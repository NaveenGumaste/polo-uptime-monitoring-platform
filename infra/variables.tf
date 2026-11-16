variable "aws_region" {
  description = "AWS region where Polo infrastructure will be created."
  type        = string
  default     = "ap-south-2"
}

variable "project_name" {
  description = "Project name used in resource tags."
  type        = string
  default     = "Polo"
}

variable "instance_type" {
  description = "EC2 instance type for the Polo stack."
  type        = string
  default     = "t3.medium"
}

variable "ssh_allowed_cidr" {
  description = "Single public IPv4 address allowed to connect through SSH."
  type        = string

  validation {
    condition = (
      can(cidrnetmask(var.ssh_allowed_cidr)) &&
      endswith(var.ssh_allowed_cidr, "/32")
    )
    error_message = "Provide a valid IPv4 CIDR ending in /32."
  }
}

variable "ssh_public_key_path" {
  description = "Local path to the SSH public key imported into EC2."
  type        = string

  validation {
    condition     = fileexists(pathexpand(var.ssh_public_key_path))
    error_message = "The SSH public key file must exist."
  }
}
