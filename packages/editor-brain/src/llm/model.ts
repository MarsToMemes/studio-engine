/**
 * The language model behind the editor brain, behind a small interface:
 * the brain never depends on a vendor SDK directly, tests replay recorded
 * answers, and any model can be plugged in.
 *
 * Output is always STRUCTURED: the model calls one tool whose input schema is
 * the editorial story (no free text to parse). The call is asked for, not
 * forced: current models (Claude Sonnet 5.5, Opus 5.5, Fable 5.1) reject a
 * forced `tool_choice`, so `auto` is used everywhere and a missing call is
 * asked for again once.
 */
import Anthropic from '@anthropic-ai/sdk';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** An image shown to the model (e.g. a still of a shot), base64-encoded. */
export interface ChatImage {
  mediaType: 'image/jpeg' | 'image/png';
  data: string;
  /** Shown as text just before the image, e.g. "Shot u3 at 9.4 s". */
  label?: string;
}

export type ChatTurn =
  | { role: 'user'; text: string; images?: ChatImage[] }
  /** The model's previous tool call, and the validation errors it gets back. */
  | {
      role: 'repair';
      toolUseId: string;
      previousInput: unknown;
      errors: string[];
      /** The model's whole previous turn (thinking blocks included), replayed unchanged: the history stays append-only. */
      assistantContent?: unknown;
    };

export interface ModelRequest {
  /** Stable instructions (cached): role, method, bible rules. */
  system: string;
  turns: ChatTurn[];
  tool: ToolSpec;
  maxTokens: number;
}

export interface ModelResponse {
  toolUseId: string;
  input: unknown;
  model: string;
  /** The whole assistant turn, to replay unchanged in a repair turn. */
  assistantContent?: unknown;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };
}

export interface EditorModel {
  readonly id: string;
  callTool(request: ModelRequest): Promise<ModelResponse>;
}

/** Default models: a capable, affordable model for analysis. */
export const DEFAULT_ANALYSIS_MODEL = 'claude-sonnet-5-5';

type MessagesClient = Pick<Anthropic, 'messages'>;

/** Added to the answer's max_tokens: adaptive thinking spends tokens before the tool call. */
const THINKING_HEADROOM_TOKENS = 8_000;
const REQUEST_TIMEOUT_MS = 20 * 60 * 1000;

export interface AnthropicModelOptions {
  model?: string;
  /** Defaults to the ANTHROPIC_API_KEY environment variable (read by the SDK). */
  apiKey?: string;
  /** Injected client (tests, proxies). */
  client?: MessagesClient;
}

/** Claude through the official SDK, with the system prompt cached across episodes. */
export class AnthropicModel implements EditorModel {
  readonly id: string;
  private readonly client: MessagesClient;

  constructor(options: AnthropicModelOptions = {}) {
    this.id = options.model ?? DEFAULT_ANALYSIS_MODEL;
    this.client = options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  }

  async callTool(request: ModelRequest): Promise<ModelResponse> {
    const messages: Anthropic.MessageParam[] = [];
    const name = request.tool.name;
    for (const turn of request.turns) {
      if (turn.role === 'user') {
        if (!turn.images?.length) messages.push({ role: 'user', content: turn.text });
        else
          messages.push({
            role: 'user',
            content: [
              ...turn.images.flatMap((img): Anthropic.ContentBlockParam[] => [
                ...(img.label ? [{ type: 'text' as const, text: img.label }] : []),
                { type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } },
              ]),
              { type: 'text', text: turn.text },
            ],
          });
      }
      else {
        const content = (turn.assistantContent as Anthropic.ContentBlockParam[] | undefined) ?? [{ type: 'tool_use', id: turn.toolUseId, name, input: turn.previousInput as Record<string, unknown> }];
        messages.push({ role: 'assistant', content });
        // Every tool call of the turn gets its result; the errors go on the answer that was checked.
        const ids = content.flatMap((b) => (b.type === 'tool_use' ? [b.id] : []));
        messages.push({
          role: 'user',
          content: (ids.length ? ids : [turn.toolUseId]).map((id): Anthropic.ToolResultBlockParam => ({
            type: 'tool_result',
            tool_use_id: id,
            is_error: true,
            content: id === turn.toolUseId ? `The answer is invalid. Fix exactly these problems and call ${name} again with the complete corrected answer:\n- ${turn.errors.join('\n- ')}` : `Ignored: call ${name} once, with the complete answer.`,
          })),
        });
      }
    }
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    // At most one extra request, when the model answered in text instead of calling the tool.
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.client.messages.create(
        {
          model: this.id,
          // Room for the model's thinking on top of the answer.
          max_tokens: request.maxTokens + THINKING_HEADROOM_TOKENS,
          system: [
            { type: 'text', text: request.system, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: `Give your answer by calling the ${name} tool once, with the complete answer. Do not answer in plain text.` },
          ],
          tools: [{ name, description: request.tool.description, input_schema: request.tool.inputSchema as Anthropic.Tool.InputSchema }],
          tool_choice: { type: 'auto' },
          messages,
        },
        // Explicit timeout: a large max_tokens is allowed without streaming.
        { timeout: REQUEST_TIMEOUT_MS },
      );
      const u = response.usage;
      usage.inputTokens += u.input_tokens;
      usage.outputTokens += u.output_tokens;
      usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
      if (response.stop_reason === 'refusal') throw new Error(`the model declined the request (${response.stop_details?.category ?? 'no category'})`);
      if (response.stop_reason === 'max_tokens') throw new Error(`the answer was cut at max_tokens (${request.maxTokens}): the input is too long for one call`);
      const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === name);
      if (call) {
        return {
          toolUseId: call.id,
          input: call.input,
          model: response.model,
          assistantContent: response.content,
          usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, ...(usage.cacheReadTokens ? { cacheReadTokens: usage.cacheReadTokens } : {}), ...(usage.cacheWriteTokens ? { cacheWriteTokens: usage.cacheWriteTokens } : {}) },
        };
      }
      if (attempt === 1 || response.content.some((b) => b.type === 'tool_use')) throw new Error(`the model did not call ${name} (stop reason: ${response.stop_reason})`);
      messages.push({ role: 'assistant', content: response.content as Anthropic.ContentBlockParam[] });
      messages.push({ role: 'user', content: `Call the ${name} tool now, with the complete answer.` });
    }
    throw new Error(`the model did not call ${name}`);
  }
}

/**
 * Replays recorded answers in order (tests, reproducible runs: a story
 * recorded once can be re-directed without calling the API again).
 */
export class RecordedModel implements EditorModel {
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(
    private readonly answers: Array<unknown | Error>,
    readonly id = 'recorded',
  ) {}

  async callTool(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    const answer = this.answers[Math.min(this.index, this.answers.length - 1)];
    this.index++;
    if (answer instanceof Error) throw answer;
    return { toolUseId: `recorded-${this.index}`, input: structuredClone(answer), model: this.id };
  }
}
