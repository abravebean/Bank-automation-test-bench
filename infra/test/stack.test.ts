// Infrastructure tests: synthesize the stack to CloudFormation (no AWS account needed)
// and check the security and cost rules hold. Run with `npm test` in infra/.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { TestBenchStack, type TestBenchStackProps } from '../lib/test-bench-stack';

function synth(overrides: Partial<TestBenchStackProps> = {}): Template {
  const app = new App();
  const stack = new TestBenchStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'us-east-1' },
    allowedCidrs: ['203.0.113.7/32'],
    image: ecs.ContainerImage.fromRegistry('example/test-bench:latest'), // no Docker build in tests
    ...overrides,
  });
  return Template.fromStack(stack);
}

/** All environment variables and secrets on the dashboard container. */
function container(template: Template) {
  const defs = template.findResources('AWS::ECS::TaskDefinition');
  const [def] = Object.values(defs);
  const c = def!.Properties.ContainerDefinitions[0];
  return {
    env: Object.fromEntries((c.Environment ?? []).map((e: { Name: string; Value: unknown }) => [e.Name, e.Value])),
    secretNames: (c.Secrets ?? []).map((s: { Name: string }) => s.Name) as string[],
  };
}

const template = synth();

describe('Database', () => {
  it('is PostgreSQL 16, encrypted, and not publicly accessible', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      EngineVersion: Match.stringLikeRegexp('^16'),
      StorageEncrypted: true,
      PubliclyAccessible: false,
    });
  });

  it('only accepts connections from the dashboard tasks, on 5432', () => {
    const rules = template.findResources('AWS::EC2::SecurityGroupIngress', {
      Properties: { FromPort: 5432, ToPort: 5432 },
    });
    const list = Object.values(rules);
    assert.equal(list.length, 1, 'exactly one ingress rule on the database port');
    assert.ok(list[0]!.Properties.SourceSecurityGroupId, 'source is a security group, not an IP range');
    assert.equal(list[0]!.Properties.CidrIp, undefined);
  });

  it('generates its password into Secrets Manager', () => {
    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      GenerateSecretString: Match.objectLike({ GenerateStringKey: 'password' }),
    });
  });
});

describe('Dashboard service', () => {
  it('keeps passwords out of plain-text environment variables', () => {
    const { env, secretNames } = container(template);
    for (const key of ['PGPASSWORD', 'PGUSER', 'BANK_PASSWORD', 'BANK_USERNAME', 'DATABASE_URL']) {
      assert.equal(env[key], undefined, `${key} must not be a plain environment variable`);
    }
    assert.deepEqual(secretNames.sort(), ['PGPASSWORD', 'PGUSER']);
  });

  it('injects bank credentials from Secrets Manager when a secret name is given', () => {
    const { secretNames } = container(synth({ bankSecretName: 'bank-test-bench/bank' }));
    for (const key of ['BANK_URL', 'BANK_USERNAME', 'BANK_PASSWORD']) assert.ok(secretNames.includes(key), key);
  });

  it('disables the Recorder and requires TLS to the database', () => {
    const { env } = container(template);
    assert.equal(env.RECORDER_ENABLED, 'false');
    assert.equal(env.DB_SSL, 'true');
  });

  it('health-checks /api/health', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      HealthCheckPath: '/api/health',
      Port: 80,
    });
  });

  it('rolls back a failed deployment automatically', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
  });

  it('keeps logs for a week, not forever', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 7 });
  });
});

describe('Network access', () => {
  it('opens the load balancer only to the allowed CIDRs', () => {
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: [Match.objectLike({ CidrIp: '203.0.113.7/32', FromPort: 80, ToPort: 80 })],
    });
    const sgs = template.findResources('AWS::EC2::SecurityGroup');
    const worldOpen = Object.values(sgs).flatMap((sg) =>
      (sg.Properties.SecurityGroupIngress ?? []).filter((r: { CidrIp?: string }) => r.CidrIp === '0.0.0.0/0')
    );
    assert.equal(worldOpen.length, 0, 'nothing is open to 0.0.0.0/0');
  });

  it('refuses to synthesize with no allowed CIDRs', () => {
    assert.throws(() => synth({ allowedCidrs: [] }), /allowedCidrs/);
  });
});

describe('Cost controls', () => {
  it('has no NAT gateway', () => {
    template.resourceCountIs('AWS::EC2::NatGateway', 0);
  });

  it('runs one small task and a micro database', () => {
    template.hasResourceProperties('AWS::ECS::Service', { DesiredCount: 1 });
    template.hasResourceProperties('AWS::RDS::DBInstance', { DBInstanceClass: 'db.t4g.micro' });
  });
});
