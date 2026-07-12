/**
 * ForwardError — "errors lead forward" design principle.
 *
 * Every error a tool can throw NAMES the next tool/step the caller should try
 * (e.g. "Agent not found; call list_agents to see valid names/ids") instead of
 * surfacing a bare status code or an opaque failure. This keeps an LLM caller
 * unblocked without a human in the loop.
 *
 * Pure by design: no import from `@modelcontextprotocol/sdk` here. The shape
 * returned by `toToolResult()` matches what the SDK expects from an error tool
 * result (`{ content: [{ type: 'text', text }], isError: true }`), but this
 * module doesn't depend on the SDK's types to produce it.
 */

/** Free-form pointer to the tool/step a caller should try next. */
export type NextStep = string;

export type ToolTextContent = {
  type: "text";
  text: string;
};

export type ForwardErrorToolResult = {
  content: ToolTextContent[];
  isError: true;
};

export class ForwardError extends Error {
  /** The tool (or step) the caller should try next to recover. */
  readonly nextStep: NextStep;

  constructor(message: string, nextStep: NextStep) {
    super(message);
    this.name = "ForwardError";
    this.nextStep = nextStep;
    // Restore prototype chain (needed when targeting ES2023 with class extends Error under some transpile paths).
    Object.setPrototypeOf(this, ForwardError.prototype);
  }

  /** Render as an MCP-SDK-shaped error tool result. */
  toToolResult(): ForwardErrorToolResult {
    return {
      content: [{ type: "text", text: `${this.message} (next: ${this.nextStep})` }],
      isError: true,
    };
  }
}
