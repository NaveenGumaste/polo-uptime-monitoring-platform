terraform {
  backend "s3" {
    bucket       = "polo-tfstate-ee3037abc3a54378b20d295b94234ec3"
    key          = "polo/terraform.tfstate"
    region       = "ap-south-2"
    encrypt      = true
    use_lockfile = true
  }
}
