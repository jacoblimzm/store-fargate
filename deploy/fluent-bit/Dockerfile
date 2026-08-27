# Custom FireLens log router: the stock aws-for-fluent-bit image plus our
# extra.conf, which splits the combined-fe container's logs into
# source:nginx vs source:python. Referenced from the task definition via
# firelensConfiguration.options.config-file-value: /extra.conf
FROM public.ecr.aws/aws-observability/aws-for-fluent-bit:stable

COPY extra.conf /extra.conf
