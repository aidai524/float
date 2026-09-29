import { readFileSync } from "node:fs";
const html = readFileSync("/tmp/fomc.html", "utf8");
const NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const monNum = (s) => {
  if (!s) return null;
  const k = s.toLowerCase().slice(0, 3);
  const i = NAMES.findIndex((n) => n.toLowerCase().startsWith(k));
  return i >= 0 ? i + 1 : null;
};
const nextM = (m) => (m === 12 ? 1 : m + 1);
const yearMarks = [...html.matchAll(/<a id="\d+">(\d{4}) FOMC Meetings<\/a>/g)].map((m) => ({
  year: +m[1],
  idx: m.index,
}));
const re =
  /fomc-meeting__month[^>]*><strong>([A-Za-z]+)(?:\/([A-Za-z]+))?<\/strong><\/div>\s*<div class="fomc-meeting__date[^>]*>(\d{1,2})(?:-(\d{1,2}))?\*?<\/div>/g;
let total = 0;
for (let i = 0; i < yearMarks.length; i++) {
  const seg = html.slice(
    yearMarks[i].idx,
    i + 1 < yearMarks.length ? yearMarks[i + 1].idx : html.length,
  );
  const list = [];
  for (const m of seg.matchAll(re)) {
    const mon = monNum(m[1]),
      mon2 = monNum(m[2]);
    const d1 = +m[3],
      d2 = m[4] ? +m[4] : d1;
    const month = mon2 ?? (d2 < d1 ? nextM(mon) : mon);
    if (!month) continue;
    list.push(
      `${yearMarks[i].year}-${String(month).padStart(2, "0")}-${String(d2).padStart(2, "0")}`,
    );
  }
  total += list.length;
  console.log(yearMarks[i].year, list.length, "场:", list.join(" "));
}
console.log("总计", total);
