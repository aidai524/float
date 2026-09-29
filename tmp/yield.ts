import { classifyListing, extractSymbols } from "../packages/data-layer/src/sources/announcements";
async function main() {
  const UA = { "User-Agent": "Mozilla/5.0 (compatible; MoonEventBot/0.1)" };
  const url =
    "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=48&pageNo=1&pageSize=50";
  const payload: any = await (await fetch(url, { headers: UA })).json();
  const arts: any[] = payload.data.catalogs.flatMap((c: any) => c.articles ?? []);
  let kept = 0,
    skipped = 0;
  for (const a of arts) {
    const cls = classifyListing(a.title);
    const syms = extractSymbols(a.title);
    if (cls && syms.length) kept += syms.length;
    else skipped++;
  }
  console.log(`共 ${arts.length} 条公告 → 产出 ${kept} 个事件，跳过 ${skipped} 条`);
  console.log("--- 前 10 条判定 ---");
  for (const a of arts.slice(0, 10)) {
    const cls = classifyListing(a.title);
    const syms = extractSymbols(a.title);
    console.log(`${cls ? "✓" : "✗"} [${syms.join(",") || "-"}] ${a.title.slice(0, 60)}`);
  }
}
main();
