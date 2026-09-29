/**
 * 适配器注册表。
 * 新增 Tier B 源：在 sources/ 下加文件并调用 register()，此文件无需改动。
 * Tier A 源（generic-rest）已默认注册，靠 data_sources.config 驱动。
 */
import type { DataSourceAdapter } from "./types";
import { genericRestAdapter } from "./sources/generic-rest";
import { binanceAdapter } from "./sources/binance";
import { binanceAnnouncementsAdapter, bybitAnnouncementsAdapter } from "./sources/announcements";
import { coinMarketCalAdapter } from "./sources/coinmarketcal";
import { coinMarketCapUnlocksAdapter } from "./sources/coinmarketcap-unlocks";
import { defiLlamaUnlocksAdapter } from "./sources/defillama-unlocks";
import { fredMacroAdapter } from "./sources/fred-macro";
import { fedFomcAdapter } from "./sources/fed-fomc";

const registry = new Map<string, DataSourceAdapter>();

export function register(adapter: DataSourceAdapter): void {
  if (registry.has(adapter.id)) throw new Error(`adapter already registered: ${adapter.id}`);
  registry.set(adapter.id, adapter);
}

export function getAdapter(id: string): DataSourceAdapter | undefined {
  return registry.get(id);
}

export function listAdapters(): string[] {
  return [...registry.keys()];
}

// ---- 内置注册 ----
register(genericRestAdapter);
register(binanceAdapter);
register(binanceAnnouncementsAdapter);
register(bybitAnnouncementsAdapter);
register(coinMarketCalAdapter);
register(coinMarketCapUnlocksAdapter);
register(defiLlamaUnlocksAdapter);
register(fredMacroAdapter);
register(fedFomcAdapter);
