/**
 * 领域判断任务：把 System One 的判断接入数据层。
 * 对应 DATA-LAYER.md：L1 事件分类、L2 实体解析、L4 可比事件重排。
 */
import { AssetClassSchema, EventTypeSchema, type AssetClass, type EventType } from "@cee/shared";
import type { JevClient } from "./client";

/** 事件类型判定的 rubric（用于 Choice 的 criteria） */
export const EVENT_TYPE_CRITERIA: Record<EventType, string | null> = {
  unlock_cliff: "A one-time large token release at a cliff/vesting date",
  unlock_linear: "Ongoing or continuous token release/emission/vesting",
  tge: "Token generation event / first tradable launch",
  airdrop: "Free token distribution to users",
  burn: "Token burn, buyback, or supply reduction",
  migration: "Token swap, migration, or contract upgrade of the token itself",
  listing_cex: "A centralized exchange lists/trades the token, or adds new spot/margin pairs",
  listing_dex: "A DEX pool is created or the token is listed on a DEX",
  listing_futures: "A futures/perpetual contract for the token is launched",
  delisting: "A token or pair is being delisted/removed from an exchange",
  mainnet_launch: "Mainnet / L1 / L2 launch, or a new chain going live",
  testnet: "Testnet activation, stressnet, or public test network milestone",
  upgrade: "Protocol, mainnet, or node software upgrade / hard fork / activation",
  halving: "Block reward halving",
  incentive: "Emissions program, staking rewards, incentives, or reward changes",
  partnership: "Partnership, collaboration, or business announcement",
  integration: "Integration, SDK/tooling support, or interoperability work",
  governance: "Governance vote or proposal",
  macro_fomc: "Central bank interest-rate decision",
  macro_cpi: "Inflation / CPI data release",
  etf: "ETF approval or decision",
  exploit: "Hack, exploit, or loss of funds",
  unknown: "None of the above, or not enough information",
};

export interface EventTypeJudgment {
  event_type: EventType;
  confidence: number;
  probabilities: Record<string, number>;
}

/** L1：公告/文本 → 统一事件类型 */
export async function classifyEventType(
  client: JevClient,
  state: unknown,
): Promise<EventTypeJudgment> {
  const a = await client.choice(
    state,
    "event_type",
    "Which single event type best describes this announcement?",
    EVENT_TYPE_CRITERIA,
  );
  const parsed = EventTypeSchema.safeParse(a.choice);
  return {
    event_type: parsed.success ? parsed.data : "unknown",
    confidence: a.confidence,
    probabilities: a.probabilities,
  };
}

export interface SameEventJudgment {
  same: boolean;
  probability: number;
}

/** L2：两条源记录是否描述同一事件（canonicalKey 抓不到的模糊情况） */
export async function isSameEvent(
  client: JevClient,
  recordA: unknown,
  recordB: unknown,
): Promise<SameEventJudgment> {
  const a = await client.noul(
    { record_a: recordA, record_b: recordB },
    "same_event",
    "Do `record_a` and `record_b` describe the same single event?",
    {
      true: "Same event, differing only in wording or source",
      false: "Different events, or clearly not the same occurrence",
    },
  );
  return { same: a.noul >= 0.5, probability: a.noul };
}

/** 代币类别 rubric（用于 token 分类） */
export const TOKEN_CATEGORY_CRITERIA = {
  l1: "Layer 1 blockchain / smart contract platform",
  l2: "Layer 2, rollup, or scaling solution",
  defi: "DeFi protocol: DEX, lending, derivatives, yield",
  rwa: "Real-world asset tokenization: tokenized stocks, ETFs, commodities, treasuries, real estate",
  stablecoin: "Stablecoin or stable-value asset",
  meme: "Meme coin or community-driven culture token",
  gaming: "Gaming, metaverse, or NFT ecosystem token",
  ai: "AI, compute, or data-network token",
  infrastructure: "Oracles, storage, indexing, interoperability, middleware",
  exchange: "Exchange, CeFi, or broker token",
  privacy: "Privacy-focused currency or protocol",
  payment: "Payment, remittance, or currency token",
  other: "None of the above",
} as const;

export type TokenCategory = keyof typeof TOKEN_CATEGORY_CRITERIA;

export const TOKEN_CATEGORY_IDS = Object.keys(TOKEN_CATEGORY_CRITERIA) as TokenCategory[];

/** 代币类别判定（单条，可批量调用 ask 并行） */
export function tokenCategoryQuestion(symbol: string, name: string | null) {
  return {
    type: "choice" as const,
    instructions: {
      symbol,
      name: name ?? undefined,
      question: "What category best describes this crypto asset?",
    },
    criteria: TOKEN_CATEGORY_CRITERIA,
  };
}

/** 资产类别 rubric。RWA 包含代币化股票/ETF/商品/国债——属于 web3 场景，不排除。 */
export const ASSET_CLASS_CRITERIA: Record<AssetClass, string> = {
  crypto: "A crypto-native token, protocol, or on-chain asset",
  rwa: "A tokenized real-world asset: tokenized stocks, ETFs, commodities, treasuries, real estate",
  unknown: "Cannot tell, or not an asset listing/trading announcement",
};

export interface AssetClassJudgment {
  asset_class: AssetClass;
  confidence: number;
  probabilities: Record<string, number>;
}

/** 判定资产类别（crypto / rwa / unknown） */
export async function classifyAssetClass(
  client: JevClient,
  state: unknown,
): Promise<AssetClassJudgment> {
  const a = await client.choice(
    state,
    "asset_class",
    "What asset class does this announcement concern?",
    ASSET_CLASS_CRITERIA,
  );
  const parsed = AssetClassSchema.safeParse(a.choice);
  return {
    asset_class: parsed.success ? parsed.data : "unknown",
    confidence: a.confidence,
    probabilities: a.probabilities,
  };
}

export interface Judgment<T> {
  action: "accept" | "review" | "reject";
  value: T;
  confidence: number;
}

/**
 * 置信度分级：高置信自动接受，中间转人工，低置信拒绝。
 * 概率型判断请先用 probabilityToConfidence() 转换。
 */
export function gate<T>(
  value: T,
  confidence: number,
  thresholds: { auto?: number; review?: number } = {},
): Judgment<T> {
  const auto = thresholds.auto ?? 0.85;
  const review = thresholds.review ?? 0.5;
  const action = confidence >= auto ? "accept" : confidence >= review ? "review" : "reject";
  return { action, value, confidence };
}

/** 把 Noul 的 yes 概率转成"离开 0.5 的确定度" */
export function probabilityToConfidence(p: number): number {
  return Math.abs(p - 0.5) * 2;
}
