import { describe, expect, it, vi } from "vitest";
import { JevClient } from "../src/client";
import { classifyEventType, gate, isSameEvent, probabilityToConfidence } from "../src/tasks";

function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

describe("JevClient", () => {
  it("noul 解析", async () => {
    const f = fakeFetch({ model: "jev-1.13.0", answers: { q: { type: "noul", noul: 0.81 } } });
    const c = new JevClient({ apiKey: "k", fetchImpl: f });
    const a = await c.noul("state", "q", "Is it urgent?");
    expect(a.noul).toBe(0.81);
  });

  it("非 2xx 抛错", async () => {
    const f = fakeFetch({ detail: "bad" }, false, 401);
    const c = new JevClient({ apiKey: "k", fetchImpl: f });
    await expect(c.noul("s", "q", "x")).rejects.toThrow(/401/);
  });

  it("缺 apiKey 抛错", () => {
    expect(() => new JevClient({ apiKey: "" })).toThrow();
  });
});

describe("领域判断", () => {
  it("classifyEventType 映射到已知类型", async () => {
    const f = fakeFetch({
      model: "jev-1.13.0",
      answers: {
        event_type: {
          type: "choice",
          choice: "unlock_cliff",
          probabilities: { unlock_cliff: 0.98, unlock_linear: 0.02 },
          confidence: 0.98,
        },
      },
    });
    const c = new JevClient({ apiKey: "k", fetchImpl: f });
    const r = await classifyEventType(c, "Arbitrum unlocks 92.65M ARB on 2026-10-16");
    expect(r.event_type).toBe("unlock_cliff");
    expect(r.confidence).toBeCloseTo(0.98);
  });

  it("未知选项降级为 unknown", async () => {
    const f = fakeFetch({
      model: "m",
      answers: {
        event_type: { type: "choice", choice: "nonsense", probabilities: {}, confidence: 0.3 },
      },
    });
    const c = new JevClient({ apiKey: "k", fetchImpl: f });
    const r = await classifyEventType(c, "???");
    expect(r.event_type).toBe("unknown");
  });

  it("isSameEvent 以 0.5 为界", async () => {
    const f = fakeFetch({
      model: "m",
      answers: { same_event: { type: "noul", noul: 0.96 } },
    });
    const c = new JevClient({ apiKey: "k", fetchImpl: f });
    const r = await isSameEvent(c, { a: 1 }, { b: 2 });
    expect(r.same).toBe(true);
    expect(r.probability).toBe(0.96);
  });
});

describe("置信度分级", () => {
  it("gate 三档", () => {
    expect(gate("v", 0.9).action).toBe("accept");
    expect(gate("v", 0.6).action).toBe("review");
    expect(gate("v", 0.2).action).toBe("reject");
  });

  it("probabilityToConfidence", () => {
    expect(probabilityToConfidence(0.5)).toBe(0);
    expect(probabilityToConfidence(0.96)).toBeCloseTo(0.92);
    expect(probabilityToConfidence(0.04)).toBeCloseTo(0.92);
  });
});
