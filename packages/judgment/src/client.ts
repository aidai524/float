/**
 * TypeSafe / Jev 客户端（System One）。
 * 返回类型化判断 + 概率，不生成文本。
 * 文档：https://docs.typesafe.ai/api.md
 */
import { z } from "zod";

export const NoulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number(),
});

export const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.number()),
  confidence: z.number(),
});

export const ScoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.string(),
  probabilities: z.record(z.number()),
  confidence: z.number(),
});

export type NoulAnswer = z.infer<typeof NoulAnswerSchema>;
export type ChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;
export type ScoreAnswer = z.infer<typeof ScoreAnswerSchema>;

const ResponseSchema = z.object({
  model: z.string(),
  answers: z.record(z.unknown()),
  usage: z
    .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
    .optional(),
});

export interface JevClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

type QuestionMap = Record<string, Record<string, unknown>>;

export class JevClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: JevClientOptions) {
    if (!opts.apiKey) throw new Error("JevClient: apiKey is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? "https://api.typesafe.ai";
    this.model = opts.model ?? "jev-latest";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** 原始调用：一次请求可提多个问题（并行，互相不可见） */
  async ask(state: unknown, questions: QuestionMap): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/systemone`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state, model: this.model, questions }),
    });
    if (!res.ok) {
      throw new Error(`Jev request failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
    const parsed = ResponseSchema.parse(await res.json());
    return parsed.answers;
  }

  async noul(
    state: unknown,
    id: string,
    instructions: unknown,
    criteria?: { true?: string; false?: string },
  ): Promise<NoulAnswer> {
    const answers = await this.ask(state, { [id]: { type: "noul", instructions, criteria } });
    return NoulAnswerSchema.parse(answers[id]);
  }

  async choice(
    state: unknown,
    id: string,
    instructions: unknown,
    criteria: Record<string, string | null>,
  ): Promise<ChoiceAnswer> {
    const answers = await this.ask(state, { [id]: { type: "choice", instructions, criteria } });
    return ChoiceAnswerSchema.parse(answers[id]);
  }

  async score(
    state: unknown,
    id: string,
    instructions: unknown,
    criteria: Record<string, string | null>,
  ): Promise<ScoreAnswer> {
    const answers = await this.ask(state, { [id]: { type: "score", instructions, criteria } });
    return ScoreAnswerSchema.parse(answers[id]);
  }
}
