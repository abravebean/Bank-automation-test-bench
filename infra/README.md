# AWS deployment (CDK)

Infrastructure as code for running the Test Bench dashboard on AWS, written in TypeScript with the [AWS CDK](https://docs.aws.amazon.com/cdk/).

```
Internet ──▶ Application Load Balancer  (HTTP 80, only from the CIDRs you allow)
                  │
                  ▼
             ECS Fargate task: dashboard + Chromium   (public subnet, 1 vCPU / 2 GB)
                  │  PostgreSQL over verified TLS
                  ▼
             RDS PostgreSQL 16, db.t4g.micro          (isolated subnet, no internet route)
```

| Concern | How it's handled |
| --- | --- |
| Secrets | The database password is generated into **Secrets Manager**. Bank test credentials come from a secret you create. Both are injected into the container at start-up and never appear in the template, the task definition's environment, or GitHub. |
| Network | The database sits in isolated subnets and only accepts connections from the dashboard's security group on 5432. The load balancer is open only to the CIDRs you pass in. Nothing is open to `0.0.0.0/0` (an infrastructure test enforces this). |
| Encryption | RDS storage is encrypted, and the app requires a verified TLS connection to the database (the image trusts Amazon's RDS CA bundle). |
| Recorder | Turned off (`RECORDER_ENABLED=false`): it starts processes and writes files, which a shared server should never do. |
| Reliability | `/api/health` is the load balancer health check. A deployment that never becomes healthy rolls back automatically (ECS circuit breaker). |
| Cost | No NAT gateway, one task, the smallest RDS instance, one day of backups, one week of logs. |

## Tests

The stack has its own tests in `test/stack.test.ts`. They synthesize the CloudFormation template (no AWS account needed) and check the rules above: encryption, no public database, secrets not in plain text, no world-open security groups, health check path, rollback, log retention, no NAT gateway, instance sizes. CI runs them, plus a full `cdk synth`, on every push.

```bash
cd infra
npm ci
npm test                                         # infrastructure tests
npx cdk synth -c allowedCidrs=203.0.113.7/32     # see the generated CloudFormation
```

## Deploying

### One-time setup

1. **Bootstrap CDK** in your account and region (creates the ECR repo and roles CDK deploys with):
   ```bash
   npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1
   ```
2. **Bank test credentials (optional).** Create a secret named `bank-test-bench/bank` with the keys `BANK_URL`, `BANK_USERNAME` and `BANK_PASSWORD`:
   ```bash
   aws secretsmanager create-secret --name bank-test-bench/bank \
     --secret-string '{"BANK_URL":"https://...","BANK_USERNAME":"...","BANK_PASSWORD":"..."}'
   ```
   Use **demo bank** credentials only.

### From your machine

```bash
cd infra
npm ci
npx cdk deploy -c allowedCidrs=$(curl -s https://checkip.amazonaws.com)/32 -c bankSecretName=bank-test-bench/bank
```

The `DashboardUrl` output is the address to open. `allowedCidrs` takes a comma-separated list; without it, the stack lets nobody in.

### From GitHub Actions

`.github/workflows/deploy.yml` deploys on demand (**Actions → Deploy to AWS → Run workflow**). It:

1. runs the infrastructure tests,
2. gets short-lived AWS credentials through **OIDC** (no access keys stored in GitHub),
3. runs `cdk deploy`, which builds the Docker image and pushes it to ECR,
4. runs the **Postman collections against the live URL** as post-deploy smoke tests, and uploads their report.

It needs an IAM role GitHub can assume, saved as the repository secret `AWS_DEPLOY_ROLE_ARN`, and a GitHub environment named `aws`:

- Identity provider: `token.actions.githubusercontent.com`, audience `sts.amazonaws.com`
- Trust policy condition: `token.actions.githubusercontent.com:sub` equals `repo:abravebean/Bank-automation-test-bench:environment:aws`
- Permissions: `sts:AssumeRole` on `arn:aws:iam::<ACCOUNT_ID>:role/cdk-*` (the bootstrap roles do the actual deploy)

The runner's own IP is added to `allowedCidrs` so the smoke tests can reach the dashboard.

## Cost and teardown

Left running, the load balancer, Fargate task, database and public IPv4 addresses cost on the order of $60–80 a month in us-east-1. Check the [AWS Pricing Calculator](https://calculator.aws/) for your region. Deploy for a demo, then remove everything:

```bash
cd infra && npx cdk destroy
```

The database is deleted with the stack (demo data only). A production database would keep a final snapshot instead.

## What a production setup would add

HTTPS with a domain and an ACM certificate, authentication in front of the dashboard, a NAT gateway with tasks in private subnets, Multi-AZ RDS, and alarms on the health check and error rates.
