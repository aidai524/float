/** 读侧契约：与 api.tokens_v1 列一一对应。 */
import { z } from "zod";

export const TokenV1Schema = z.object({
  id: z.number().int(),
  symbol: z.string(),
  name: z.string().nullable(),
  chain: z.string().nullable(),
  category: z.string().nullable(),
  market_cap: z.number().nullable(),
  adv_30d: z.number().nullable(),
  event_count: z.number().int(),
  last_event_at: z.string().nullable(),
});
export type TokenV1 = z.infer<typeof TokenV1Schema>;

export const TOKENS_V1_COLUMNS = Object.keys(TokenV1Schema.shape) as ReadonlyArray<keyof TokenV1>;
