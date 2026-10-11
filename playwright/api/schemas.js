// JSON Schemas for the dashboard API's responses (the API contract).
// If a response's shape changes, these tests fail before the dashboard breaks.

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

module.exports = { testListSchema, logEventSchema, resultEventSchema, notFoundSchema };
