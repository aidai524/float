/** 版本化 REST 响应信封。所有 /api/v1/* 都返回此形状。 */
import { z } from "zod";

export const ApiMetaSchema = z.object({
  count: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  methodology_version: z.string(),
});

export function apiList<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    meta: ApiMetaSchema,
  });
}

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
