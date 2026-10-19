// JSON Schemas for the dashboard API's responses (the API contract).
// If a response's shape changes, these tests fail before the dashboard breaks.

const ISO_DATE = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$';

const testListSchema = {
  type: 'array',
  minItems: 1,
  items: {
    type: 'object',
    required: ['name', 'description', 'engine'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1 },
      description: { type: 'string' },
      engine: { enum: ['selenium', 'playwright'] },
    },
  },
};

const logEventSchema = {
  type: 'object',
  required: ['type', 'test', 'message'],
  properties: {
    type: { const: 'log' },
    test: { type: 'string' },
    message: { type: 'string' },
  },
};

const resultEventSchema = {
  type: 'object',
  required: ['type', 'name', 'passed', 'message', 'durationMs'],
  properties: {
    type: { const: 'result' },
    name: { type: 'string' },
    passed: { type: 'boolean' },
    message: { type: 'string' },
    durationMs: { type: 'integer', minimum: 0 },
    runId: { type: 'integer', minimum: 1 },
  },
};

const runSchema = {
  type: 'object',
  required: ['id', 'name', 'engine', 'passed', 'message', 'durationMs', 'startedAt'],
  additionalProperties: false,
  properties: {
    id: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1 },
    engine: { enum: ['selenium', 'playwright'] },
    passed: { type: 'boolean' },
    message: { type: 'string' },
    durationMs: { type: 'integer', minimum: 0 },
    startedAt: { type: 'string', pattern: ISO_DATE },
  },
};

const runListSchema = { type: 'array', items: runSchema };

const statsSchema = {
  type: 'array',
  items: {
    type: 'object',
    required: ['name', 'engine', 'totalRuns', 'passedRuns', 'passRate', 'avgDurationMs', 'lastRunAt', 'flaky'],
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      engine: { enum: ['selenium', 'playwright'] },
      totalRuns: { type: 'integer', minimum: 1 },
      passedRuns: { type: 'integer', minimum: 0 },
      passRate: { type: 'number', minimum: 0, maximum: 1 },
      avgDurationMs: { type: 'integer', minimum: 0 },
      lastRunAt: { type: 'string', pattern: ISO_DATE },
      flaky: { type: 'boolean' },
    },
  },
};

const healthSchema = {
  type: 'object',
  required: ['status', 'database'],
  properties: {
    status: { const: 'ok' },
    database: { enum: ['up', 'down', 'disabled'] },
  },
};

const notFoundSchema = {
  type: 'object',
  required: ['name', 'passed', 'message'],
  properties: {
    name: { type: 'string' },
    passed: { const: false },
    message: { const: 'Test not found' },
  },
};

export {
  testListSchema,
  logEventSchema,
  resultEventSchema,
  notFoundSchema,
  runSchema,
  runListSchema,
  statsSchema,
  healthSchema,
};
