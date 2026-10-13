/**
 * 浏览器端 Supabase 客户端（仅用于用户自己的数据：登录态 / watchlist / 告警偏好）。
 * 公共研究数据仍只读 api.* 契约视图（服务端构建期）。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: { key: string; client: SupabaseClient } | null = null;

export function browserSupabase(url: string, anonKey: string): SupabaseClient {
  const key = `${url}|${anonKey}`;
  if (cached?.key === key) return cached.client;
  const client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  cached = { key, client };
  return client;
}
