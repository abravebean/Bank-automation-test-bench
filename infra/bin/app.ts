#!/usr/bin/env node
// Entry point for `cdk synth` / `cdk deploy`.
//
//   npx cdk deploy -c allowedCidrs=203.0.113.7/32 -c bankSecretName=bank-test-bench/bank
//
// allowedCidrs: comma-separated CIDRs that may open the dashboard (default: nobody, so you must set it).
// bankSecretName: optional Secrets Manager secret with BANK_URL, BANK_USERNAME, BANK_PASSWORD.
import { App, Tags } from 'aws-cdk-lib';
import { TestBenchStack } from '../lib/test-bench-stack';

const app = new App();

const cidrs = String(app.node.tryGetContext('allowedCidrs') ?? '')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);

const stack = new TestBenchStack(app, 'BankTestBench', {
  description: 'Bank Login Test Bench: dashboard on ECS Fargate with RDS PostgreSQL run history',
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  allowedCidrs: cidrs.length ? cidrs : ['127.0.0.1/32'], // placeholder that lets nobody in
  bankSecretName: app.node.tryGetContext('bankSecretName') || undefined,
});

Tags.of(stack).add('project', 'bank-test-bench');
Tags.of(stack).add('purpose', 'portfolio-demo');
