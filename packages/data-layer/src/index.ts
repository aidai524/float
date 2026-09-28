/**
 * 数据层对外唯一入口（仅数据层内部 / 采集 Worker 使用）。
 * apps/web 与 apps/api 绝不 import 这里；它们只读 api.* 契约视图。
 */
export * from "./types";
export { register, getAdapter, listAdapters } from "./registry";
export { runSource, runAll, recordDedupeKey } from "./pipeline";
export type { DB } from "./pipeline";
export { resolveEvents, canonicalKey } from "./resolve";
export { hasQuota, usedToday, bump } from "./quota";
export type { KVLike } from "./quota";
