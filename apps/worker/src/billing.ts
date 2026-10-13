/**
 * Crypto（USDC）订阅 —— 自托管链上验证，无第三方支付服务。
 *
 * 流程：
 *   GET  /api/v1/billing/status  （需登录）→ 当前档位 + 收款信息（链 / 地址 / 价格 / USDC 合约）
 *   POST /api/v1/billing/verify  （需登录）{ tx_hash } → 查链验证并续期 Pro
 *
 * 验证规则：交易成功 + ERC-20 Transfer 到收款地址 + 金额 ≥ 价格 + 链上确认数 ≥ 2 + tx 未用过。
 * 配置（Worker secrets/vars）：
 *   CRYPTO_PAY_TO     收款地址（必填；未配置时接口返回 503）
 *   CRYPTO_CHAIN      base（默认）| polygon | arbitrum | ethereum
 *   CRYPTO_RPC_URL    自定义 RPC（可选）
 *   PRO_PRICE_USD     默认 19
 *   PRO_PERIOD_DAYS   默认 30
 */
import type { ApiEnv } from "./api";

interface Env extends ApiEnv {
  CRYPTO_PAY_TO?: string;
  CRYPTO_CHAIN?: string;
  CRYPTO_RPC_URL?: string;
  PRO_PRICE_USD?: string;
  PRO_PERIOD_DAYS?: string;
}

const CHAINS: Record<string, { rpcs: string[]; usdc: string; decimals: number }> = {
  base: {
    rpcs: [
      "https://base.drpc.org",
      "https://1rpc.io/base",
      "https://gateway.tenderly.co/public/base",
      "https://base-rpc.publicnode.com",
    ],
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
  },
  polygon: {
    rpcs: ["https://polygon.drpc.org", "https://1rpc.io/matic", "https://polygon-rpc.com"],
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    decimals: 6,
  },
  arbitrum: {
    rpcs: ["https://arbitrum.drpc.org", "https://1rpc.io/arb", "https://arb1.arbitrum.io/rpc"],
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    decimals: 6,
  },
  ethereum: {
    rpcs: ["https://eth.drpc.org", "https://1rpc.io/eth", "https://ethereum-rpc.publicnode.com"],
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
  },
};

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MIN_CONFIRMATIONS = 2;

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

function bjson(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
      ...(init.headers ?? {}),
    },
  });
}

function bfail(status: number, error: string, detail?: unknown): Response {
  return bjson({ ok: false, error, ...(detail === undefined ? {} : { detail }) }, { status });
}

function config(env: Env) {
  const chain = (env.CRYPTO_CHAIN ?? "base").toLowerCase();
  const c = CHAINS[chain];
  if (!c || !env.CRYPTO_PAY_TO) return null;
  return {
    chain,
    rpcs: env.CRYPTO_RPC_URL ? [env.CRYPTO_RPC_URL, ...c.rpcs] : c.rpcs,
    usdc: c.usdc,
    decimals: c.decimals,
    payTo: env.CRYPTO_PAY_TO,
    priceUsd: Number(env.PRO_PRICE_USD ?? "19"),
    periodDays: Number(env.PRO_PERIOD_DAYS ?? "30"),
  };
}

/** 校验 Supabase 用户 JWT（通过 /auth/v1/user），返回 user id */
async function requireUser(request: Request, env: Env): Promise<string | null> {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: auth,
    },
  });
  if (!res.ok) return null;
  const user = (await res.json().catch(() => null)) as { id?: string } | null;
  return user?.id ?? null;
}

/** JSON-RPC（多端点兜底：各公共网关对旧区块/限流策略不同） */
async function rpc<T>(urls: string[], method: string, params: unknown[]): Promise<T | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!res.ok) continue;
      const body = (await res.json().catch(() => null)) as { result?: T } | null;
      if (body && body.result !== undefined) return body.result;
    } catch {
      // 换下一个端点
    }
  }
  return null;
}

interface Log {
  address?: string;
  topics?: string[];
  data?: string;
}
interface Receipt {
  status?: string;
  blockNumber?: string;
  logs?: Log[];
}

/** 从 receipt 日志中汇总「转入收款地址」的 USDC 金额（最小单位） */
export function sumIncomingUsdc(
  logs: Log[] | undefined,
  usdc: string,
  payTo: string,
): { total: bigint; from: string | null } {
  const target = payTo.toLowerCase();
  let total = 0n;
  let from: string | null = null;
  for (const log of logs ?? []) {
    if (!log.address || !log.topics || !log.data) continue;
    if (log.address.toLowerCase() !== usdc.toLowerCase()) continue;
    if ((log.topics[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) continue;
    if (log.topics.length < 3) continue;
    const to = `0x${(log.topics[2] ?? "").slice(26)}`.toLowerCase();
    if (to !== target) continue;
    total += BigInt(log.data);
    from = from ?? `0x${(log.topics[1] ?? "").slice(26)}`.toLowerCase();
  }
  return { total, from };
}

async function getUserSubscription(env: Env, userId: string): Promise<any | null> {
  const res = await fetch(
    `${env.SUPABASE_URL!.replace(/\/$/, "")}/rest/v1/subscriptions?user_id=eq.${userId}&select=*&limit=1`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
      },
    },
  );
  if (!res.ok) return null;
  const rows = (await res.json().catch(() => [])) as any[];
  return rows[0] ?? null;
}

function effectiveTier(sub: any | null): {
  tier: string;
  active: boolean;
  expiresAt: string | null;
} {
  if (!sub) return { tier: "free", active: false, expiresAt: null };
  const active = sub.status === "active" && sub.expires_at && new Date(sub.expires_at) > new Date();
  return {
    tier: active ? (sub.tier ?? "free") : "free",
    active: Boolean(active),
    expiresAt: sub.expires_at ?? null,
  };
}

export async function handleBilling(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const path = url.pathname.replace(/^\/api\/v1/, "");
  const userId = await requireUser(request, env);
  if (!userId) return bfail(401, "unauthorized", "需要登录（Supabase access token）");

  const cfg = config(env);

  if (path === "/billing/status" && request.method === "GET") {
    const sub = await getUserSubscription(env, userId);
    const eff = effectiveTier(sub);
    return bjson({
      ok: true,
      tier: eff.tier,
      active: eff.active,
      expires_at: eff.expiresAt,
      price_usd: cfg?.priceUsd ?? null,
      period_days: cfg?.periodDays ?? null,
      chain: cfg?.chain ?? null,
      pay_to: cfg?.payTo ?? null,
      usdc_address: cfg?.usdc ?? null,
      configured: Boolean(cfg),
    });
  }

  if (path === "/billing/verify" && request.method === "POST") {
    if (!cfg) return bfail(503, "billing_not_configured", "收款地址未配置");
    let body: { tx_hash?: string } = {};
    try {
      body = (await request.json()) as { tx_hash?: string };
    } catch {
      return bfail(400, "invalid_body");
    }
    const txHash = (body.tx_hash ?? "").trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return bfail(400, "invalid_tx_hash");

    const receipt = await rpc<Receipt>(cfg.rpcs, "eth_getTransactionReceipt", [txHash]);
    if (!receipt) return bfail(404, "tx_not_found");
    if (receipt.status !== "0x1") return bfail(400, "tx_failed");
    if (!receipt.blockNumber) return bfail(502, "missing_block_number");

    const latestHex = await rpc<string>(cfg.rpcs, "eth_blockNumber", []);
    const confirmations =
      latestHex != null ? Number(BigInt(latestHex) - BigInt(receipt.blockNumber)) + 1 : 1;
    if (confirmations < MIN_CONFIRMATIONS) {
      return bfail(400, "not_enough_confirmations", { confirmations, required: MIN_CONFIRMATIONS });
    }

    const { total, from } = sumIncomingUsdc(receipt.logs, cfg.usdc, cfg.payTo);
    const priceMicro = BigInt(Math.round(cfg.priceUsd * 10 ** cfg.decimals));
    if (total < priceMicro) {
      return bfail(400, "amount_below_price", {
        received_usdc: Number(total) / 10 ** cfg.decimals,
        required_usdc: cfg.priceUsd,
      });
    }

    const block = await rpc<{ timestamp?: string }>(cfg.rpcs, "eth_getBlockByNumber", [
      receipt.blockNumber,
      false,
    ]);
    const blockTs =
      block?.timestamp != null
        ? new Date(Number(BigInt(block.timestamp)) * 1000).toISOString()
        : null;

    const res = await fetch(
      `${env.SUPABASE_URL!.replace(/\/$/, "")}/rest/v1/rpc/apply_crypto_payment`,
      {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          p_user_id: userId,
          p_chain: cfg.chain,
          p_tx_hash: txHash.toLowerCase(),
          p_amount: Number(total) / 10 ** cfg.decimals,
          p_from: from,
          p_to: cfg.payTo.toLowerCase(),
          p_block_ts: blockTs,
          p_price: cfg.priceUsd,
          p_days: cfg.periodDays,
          p_token: cfg.usdc,
          p_raw: { confirmations, block_number: receipt.blockNumber },
        }),
      },
    );
    const text = await res.text();
    if (!res.ok) return bfail(502, "apply_failed", text.slice(0, 200));
    const applied = text ? JSON.parse(text) : null;
    if (applied == null) return bfail(409, "tx_already_used", "这笔交易已经开通过了");
    return bjson({
      ok: true,
      tier: "pro",
      expires_at: applied,
      paid_usdc: Number(total) / 10 ** cfg.decimals,
      confirmations,
    });
  }

  return bfail(404, "not_found", `unknown billing endpoint: ${path}`);
}
