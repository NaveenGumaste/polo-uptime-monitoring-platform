resource "aws_iam_role" "github_deploy" {
  name_prefix = "${lower(var.project_name)}-github-deploy-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = "sts:AssumeRoleWithWebIdentity"

        Principal = {
          Federated = aws_iam_openid_connect_provider.github.arn
        }

        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:sub" = "repo:NaveenGumaste@64587607/polo-uptime-monitoring-platform@1458538377:ref:refs/heads/main"
          }
        }
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-github-deploy-role"
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "polo-deployment-access"
  role = aws_iam_role.github_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "StartSSHSessionToPolo"
        Effect = "Allow"
        Action = "ssm:StartSession"

        Resource = [
          aws_instance.polo.arn,
          "arn:aws:ssm:${var.aws_region}::document/AWS-StartSSHSession"
        ]
      },
      {
        Sid    = "ManageOwnSessions"
        Effect = "Allow"

        Action = [
          "ssmmessages:OpenDataChannel",
          "ssm:TerminateSession"
        ]

        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:session/*"

        Condition = {
          StringEquals = {
            "ssm:resourceTag/aws:ssmmessages:session-id" = "$${aws:userid}"
          }
        }
      },
      {
        Sid      = "ReadPoloHostKey"
        Effect   = "Allow"
        Action   = "ec2:GetConsoleOutput"
        Resource = aws_instance.polo.arn
      }
    ]
  })
}

output "github_deploy_role_arn" {
  description = "IAM role assumed by the GitHub deployment workflow."
  value       = aws_iam_role.github_deploy.arn
}
