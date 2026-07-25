import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

/**
 * structured-output helpers shared by both LLM providers.
 *
 * - `toJsonSchema` converts a Zod schema to a JSON Schema (draft-07, strict
 *   object) by reusing OpenAI's bundled converter — used for OpenAI's
 *   `response_format: json_schema` AND Anthropic forced tool-use `input_schema`.
 * - `parseWithRepair` validates raw model text against the Zod schema and, on
 *   failure, returns a reprompt instruction so the caller can retry-on-error.
 */

export interface JsonSchema {
  schema: Record<string, unknown>;
  name: string;
}

/**
 * Inline every `$ref: "#/definitions/…"` pointer and drop the top-level
 * `definitions` block. `zodResponseFormat`'s converter factors out a
 * sub-schema into `definitions` whenever the SAME zod object is referenced
 * from two places in one schema (e.g. an enum reused by two sibling fields)
 * — valid JSON Schema, and fine for OpenAI/Anthropic, but Google's Gemini
 * structured-output schema (reached via the OpenRouter passthrough) has no
 * `$ref`/`definitions` support and 400s with "reference to undefined schema"
 * on any schema built this way. Since every contract's underlying shape has
 * no genuine cycles, a single non-cyclic inline pass makes the schema
 * self-contained for every provider without changing what it validates.
 */
function dereference(node: unknown, defs: Record<string, unknown>, seen: readonly string[] = []): unknown {
  if (Array.isArray(node)) return node.map((n) => dereference(n, defs, seen));
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const ref = obj.$ref;
    if (typeof ref === 'string' && ref.startsWith('#/definitions/')) {
      const key = ref.slice('#/definitions/'.length);
      if (seen.includes(key) || !(key in defs)) return obj; // cyclic/unresolvable — leave as-is
      return dereference(defs[key], defs, [...seen, key]);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'definitions' || k === '$defs') continue;
      out[k] = dereference(v, defs, seen);
    }
    return out;
  }
  return node;
}

export function toJsonSchema<T>(schema: z.ZodType<T>, name: string): JsonSchema {
  const rf = zodResponseFormat(schema as z.ZodTypeAny, name);
  const raw = rf.json_schema.schema as Record<string, unknown>;
  const defs = (raw.definitions ?? raw.$defs ?? {}) as Record<string, unknown>;
  return { schema: dereference(raw, defs) as Record<string, unknown>, name };
}

/** Best-effort extraction of a JSON object/array from a model's text output. */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  // strip ```json fences
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  // find first balanced { … } or [ … ]
  const firstObj = trimmed.indexOf('{');
  const firstArr = trimmed.indexOf('[');
  const start =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start === -1) return trimmed;
  const open = trimmed[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return trimmed.slice(start);
}

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; repromptMessage: string };

export function parseWithRepair<T>(schema: z.ZodType<T>, raw: string): ParseResult<T> {
  let parsedJson: unknown;
  try {
    // Strict json_schema mode returns pure JSON — parse it directly. Only fall
    // back to fence/brace extraction if that fails, because extractJson can be
    // fooled by ``` fences or `{` braces that appear INSIDE JSON string values
    // (e.g. markdown code blocks in an onboarding `body`).
    try {
      parsedJson = JSON.parse(raw.trim());
    } catch {
      parsedJson = JSON.parse(extractJson(raw));
    }
  } catch (e) {
    const msg = `Output was not valid JSON: ${(e as Error).message}`;
    return {
      ok: false,
      error: msg,
      repromptMessage: `${msg}\nReturn ONLY a single valid JSON object matching the schema, no prose.`,
    };
  }
  const result = schema.safeParse(parsedJson);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  return {
    ok: false,
    error: issues,
    repromptMessage: `Your JSON did not match the required schema. Fix these and return ONLY valid JSON:\n${issues}`,
  };
}
