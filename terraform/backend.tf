terraform {
  backend "s3" {
    bucket         = "pay2play-tfstate-369042512949"
    key            = "pay2play/app.tfstate"
    region         = "ap-southeast-1"
    dynamodb_table = "pay2play-tf-locks"
    encrypt        = true
  }
}
