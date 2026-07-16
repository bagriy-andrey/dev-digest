/**
 * toJsonSchema — dereferencing regression guard. `zodResponseFormat` factors a
 * zod object reused across two sibling fields into a top-level `definitions`
 * entry + a `$ref`. That's valid JSON Schema and fine for OpenAI/Anthropic,
 * but Google's Gemini structured-output schema (reached via the OpenRouter
 * passthrough) has no `$ref`/`definitions` support and 400s with "reference
 * to undefined schema" on exactly this shape — reproduced live against the
 * real API for `Brief` (risk_level/risks[].severity sharing one enum object)
 * before this fix existed. Pin: the emitted schema must be fully inlined.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { toJsonSchema } from '../src/llm/structured.js';

describe('toJsonSchema', () => {
  it('inlines a zod schema reused across two sibling fields, with no $ref/definitions left', () => {
    const Severity = z.enum(['high', 'medium', 'low']);
    const Shape = z.object({
      top_level: Severity,
      items: z.array(z.object({ nested: Severity })),
    });

    const { schema } = toJsonSchema(Shape, 'test_shape');
    const serialized = JSON.stringify(schema);

    expect(serialized).not.toContain('$ref');
    expect(schema).not.toHaveProperty('definitions');
    expect(schema).not.toHaveProperty('$defs');

    const props = schema.properties as Record<string, unknown>;
    expect(props.top_level).toEqual({ type: 'string', enum: ['high', 'medium', 'low'] });
    const items = props.items as { items: { properties: Record<string, unknown> } };
    expect(items.items.properties.nested).toEqual({ type: 'string', enum: ['high', 'medium', 'low'] });
  });

  it('leaves a schema with no reused sub-schemas unchanged in shape', () => {
    const Shape = z.object({ a: z.string(), b: z.number().int() });
    const { schema } = toJsonSchema(Shape, 'plain');
    expect(schema.properties).toEqual({
      a: { type: 'string' },
      b: { type: 'integer' },
    });
  });
});
