/**
 * The language model behind the editor brain, behind a small interface:
 * the brain never depends on a vendor SDK directly, tests replay recorded
 * answers, and any model can be plugged in.
 *
 * Output is always STRUCTURED: the model must call one tool whose input
 * schema is the editorial story (no free text to parse).
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
  | { role: 'repair'; toolUseId: string; previousInput: unknown; errors: string[] };

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
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };
}

export interface EditorModel {
  readonly id: string;
  callTool(request: ModelRequest): Promise<ModelResponse>;
}

/** Default models: a capable, affordable model for analysis. */
export const DEFAULT_ANALYSIS_MODEL = 'claude-sonnet-5';

type MessagesClient = Pick<Anthropic, 'messages'>;

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
        messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: turn.toolUseId, name: request.tool.name, input: turn.previousInput as Record<string, unknown> }] });
        messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: turn.toolUseId, is_error: true, content: `The answer is invalid. Fix exactly these problems and call ${request.tool.name} again with the complete corrected answer:\n- ${turn.errors.join('\n- ')}` }] });
      }
    }
    const response = await this.client.messages.create({
      model: this.id,
      max_tokens: request.maxTokens,
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      tools: [{ name: request.tool.name, description: request.tool.description, input_schema: request.tool.inputSchema as Anthropic.Tool.InputSchema }],
      tool_choice: { type: 'tool', name: request.tool.name },
      messages,
    });
    const call = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === request.tool.name);
    if (!call) throw new Error(`the model did not call ${request.tool.name} (stop reason: ${response.stop_reason})`);
    if (response.stop_reason === 'max_tokens') throw new Error(`the answer was cut at max_tokens (${request.maxTokens}): the input is too long for one call`);
    const u = response.usage;
    return {
      toolUseId: call.id,
      input: call.input,
      model: response.model,
      usage: { inputTokens: u.input_tokens, outputTokens: u.output_tokens, ...(u.cache_read_input_tokens ? { cacheReadTokens: u.cache_read_input_tokens } : {}), ...(u.cache_creation_input_tokens ? { cacheWriteTokens: u.cache_creation_input_tokens } : {}) },
    };
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
