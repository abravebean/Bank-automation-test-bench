import { expect } from '@playwright/test';
import Ajv, { type AnySchema } from 'ajv';
import type { StreamEvent } from './api-types';

const ajv = new Ajv({ allErrors: true });

/** Fails the test with Ajv's explanation if `data` doesn't match `schema`. */
export function expectToMatchSchema(data: unknown, schema: AnySchema): void {
  const validate = ajv.compile(schema);
  expect(validate(data), ajv.errorsText(validate.errors)).toBe(true);
}

/** Parses an NDJSON stream body (one JSON event per line). */
export function parseNdjson(text: string): StreamEvent[] {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as StreamEvent);
}
