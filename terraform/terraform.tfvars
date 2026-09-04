# Non-secret configuration for the pay2play app stack.
# (Variable defaults already match these live values; this file makes the
# environment explicit and is the place to override per-run values.)

region      = "ap-southeast-1"
account_id  = "369042512949"
project     = "pay2play"
base_domain = "dogdysseus.ai"
app_fqdn    = "pay2play.dogdysseus.ai"
origin_fqdn = "alb-origin.dogdysseus.ai"

vpc_id            = "vpc-0169d769cd12ce2ae"
public_subnet_ids = ["subnet-0290a107f38bbea6c", "subnet-038b7a2bbe4ab3223"]

execution_role_name = "jakeecsTaskExecutionRole"
task_role_name      = "jakepay2playTaskRole"

dd_site          = "datadoghq.com"
dd_env           = "production"
dd_version       = "0.1.0"
dd_llmobs_ml_app = "pay2play-chatbot"
openai_model     = "gpt-5-mini"

# NOTE: image_tag is intentionally NOT set here. It defaults to "latest" (see
# variables.tf) for local use, and CI passes -var="image_tag=<git-sha>" on the
# command line so the CLI value wins over this file.
