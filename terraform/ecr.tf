# ---------------------------------------------------------------------------
# ECR repositories for the four container images built by the pipeline.
# Explicit resources (not for_each) so each pairs cleanly with an import block.
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "backend" {
  name                 = "pay2play-backend"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = false
  }
}

resource "aws_ecr_repository" "frontend" {
  name                 = "pay2play-frontend"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = false
  }
}

resource "aws_ecr_repository" "combined_fe" {
  name                 = "pay2play-combined-fe"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = false
  }
}

resource "aws_ecr_repository" "logrouter" {
  name                 = "pay2play-logrouter"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = false
  }
}
