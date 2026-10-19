// The compliance report can be published, so secrets must never reach it.
import { test, expect } from '@playwright/test';
import { redact } from '../reporters/compliance-reporter';

test.describe('Compliance report redaction', { tag: '@R13' }, () => {
  test('hides typed credentials in step titles', () => {
    const secrets = ['demo_pass_123', 'demo_user'];
    expect(redact('Fill "demo_pass_123"', secrets)).toBe('Fill "•••••• (hidden)"');
    expect(redact('Fill "demo_user"', secrets)).toBe('Fill "•••••• (hidden)"');
  });

  test('hides a password that contains the username', () => {
    // Longest secrets are replaced first, so no fragment of the password survives.
    const secrets = ['demo_user_pass', 'demo_user'];
    expect(redact('Fill "demo_user_pass"', secrets)).not.toContain('pass');
  });

  test('leaves ordinary text alone', () => {
    expect(redact('Fill "not-a-real-user"', ['demo_pass_123'])).toBe('Fill "not-a-real-user"');
  });
});
