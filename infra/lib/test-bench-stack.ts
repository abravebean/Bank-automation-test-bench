// AWS infrastructure for the Bank Login Test Bench.
//
//   Internet ──▶ Application Load Balancer (HTTP 80, only from allowedCidrs)
//                    │
//                    ▼
//               ECS Fargate task (dashboard + Chromium), public subnet
//                    │  5432, TLS
//                    ▼
//               RDS PostgreSQL 16, isolated subnet (no internet route)
//
// Credentials never appear in the template or the task definition: the database
// password is generated into Secrets Manager, and bank test credentials come from a
// secret you create yourself. Both are injected into the container at start-up.
//
// Cost choices for a demo: no NAT gateway (tasks get a public IP for outbound calls
// to the demo bank), one small task, a db.t4g.micro instance, one day of backups.
import * as path from 'path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

export interface TestBenchStackProps extends StackProps {
  /** CIDR ranges allowed to reach the dashboard, e.g. ['203.0.113.7/32']. */
  readonly allowedCidrs: string[];
  /**
   * Name of an existing Secrets Manager secret with BANK_URL, BANK_USERNAME and
   * BANK_PASSWORD keys. Optional: without it the dashboard runs, and the login
   * tests report that BANK_URL is not set.
   */
  readonly bankSecretName?: string;
  /** Container image. Defaults to building the repo's Dockerfile; tests pass a stub. */
  readonly image?: ecs.ContainerImage;
}

export class TestBenchStack extends Stack {
  readonly service: ecsPatterns.ApplicationLoadBalancedFargateService;
  readonly database: rds.DatabaseInstance;

  constructor(scope: Construct, id: string, props: TestBenchStackProps) {
    super(scope, id, props);

    if (!props.allowedCidrs.length) {
      throw new Error('allowedCidrs must list at least one CIDR, e.g. -c allowedCidrs=203.0.113.7/32');
    }

    // ---- Network: public subnets for the ALB and tasks, isolated subnets for the database.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'database', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // ---- Database: run history (test_runs). Private, encrypted, TLS required by default on PG 16.
    this.database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      publiclyAccessible: false,
      credentials: rds.Credentials.fromGeneratedSecret('testbench'),
      databaseName: 'testbench',
      port: 5432,
      allocatedStorage: 20,
      storageEncrypted: true,
      backupRetention: Duration.days(1),
      deletionProtection: false,
      // Demo data only: `cdk destroy` removes it. A production database would keep a final snapshot.
      removalPolicy: RemovalPolicy.DESTROY,
      deleteAutomatedBackups: true,
    });

    // ---- Application: the dashboard container on Fargate behind a load balancer.
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, containerInsightsV2: ecs.ContainerInsights.DISABLED });

    const dbSecret = this.database.secret!;
    const secrets: Record<string, ecs.Secret> = {
      PGUSER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
      PGPASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
    };
    if (props.bankSecretName) {
      const bank = secretsmanager.Secret.fromSecretNameV2(this, 'BankSecret', props.bankSecretName);
      for (const key of ['BANK_URL', 'BANK_USERNAME', 'BANK_PASSWORD']) {
        secrets[key] = ecs.Secret.fromSecretsManager(bank, key);
      }
    }

    this.service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Dashboard', {
      cluster,
      cpu: 1024,
      memoryLimitMiB: 2048, // headroom for Chromium during test runs
      desiredCount: 1,
      minHealthyPercent: 100,
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      publicLoadBalancer: true,
      openListener: false, // ingress is limited to allowedCidrs below
      circuitBreaker: { rollback: true },
      taskImageOptions: {
        image:
          props.image ??
          ecs.ContainerImage.fromAsset(path.join(__dirname, '..', '..'), {
            exclude: ['node_modules', 'infra', '.git', 'test-results', 'playwright-report', 'compliance-report', 'reports', 'blob-report', '.features-gen', '.env'],
          }),
        containerPort: 3000,
        environment: {
          PORT: '3000',
          HEADLESS: 'true',
          // node-postgres reads PGHOST/PGPORT/PGDATABASE (+ PGUSER/PGPASSWORD from secrets).
          PGHOST: this.database.dbInstanceEndpointAddress,
          PGPORT: this.database.dbInstanceEndpointPort,
          PGDATABASE: 'testbench',
          DB_SSL: 'true',
          // The Recorder starts processes and writes files: never on a shared server.
          RECORDER_ENABLED: 'false',
        },
        secrets,
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: 'dashboard',
          logRetention: logs.RetentionDays.ONE_WEEK,
        }),
      },
    });

    this.service.targetGroup.configureHealthCheck({
      path: '/api/health',
      healthyHttpCodes: '200',
      interval: Duration.seconds(30),
    });

    for (const cidr of props.allowedCidrs) {
      this.service.loadBalancer.connections.allowFrom(ec2.Peer.ipv4(cidr), ec2.Port.tcp(80), `Dashboard access from ${cidr}`);
    }
    this.database.connections.allowFrom(this.service.service, ec2.Port.tcp(5432), 'Dashboard tasks to PostgreSQL');

    new CfnOutput(this, 'DashboardUrl', {
      value: `http://${this.service.loadBalancer.loadBalancerDnsName}`,
      description: 'Open this in a browser; also used by the post-deploy smoke tests',
    });
    new CfnOutput(this, 'DatabaseSecretArn', {
      value: dbSecret.secretArn,
      description: 'Generated PostgreSQL credentials (Secrets Manager)',
    });
  }
}
