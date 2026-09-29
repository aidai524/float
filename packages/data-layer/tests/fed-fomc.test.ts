import { describe, expect, it } from "vitest";
import { parseFomcCalendar } from "../src/sources/fed-fomc";

// 取自美联储页面真实片段（含跨月写法 Jan/Feb 与星号）
const HTML = `
<h4><a id="42828">2026 FOMC Meetings</a></h4>
<div class="row fomc-meeting"><div class="fomc-meeting__month col-xs-5"><strong>January</strong></div>
  <div class="fomc-meeting__date col-xs-4">27-28</div></div>
<div class="row fomc-meeting"><div class="fomc-meeting__month col-xs-5"><strong>March</strong></div>
  <div class="fomc-meeting__date col-xs-4">17-18*</div></div>
<h4><a id="36495">2023 FOMC Meetings</a></h4>
<div class="row fomc-meeting"><div class="fomc-meeting__month col-xs-5"><strong>Jan/Feb</strong></div>
  <div class="fomc-meeting__date col-xs-4">31-1</div></div>
<div class="row fomc-meeting"><div class="fomc-meeting__month col-xs-5"><strong>March</strong></div>
  <div class="fomc-meeting__date col-xs-4">21-22*</div></div>
<h4><a id="27443">2021 FOMC Meetings</a></h4>
<div class="row fomc-meeting"><div class="fomc-meeting__month col-xs-5"><strong>November</strong></div>
  <div class="fomc-meeting__date col-xs-4">2-3</div></div>
`;

describe("parseFomcCalendar", () => {
  it("取会议最后一天作为声明日", () => {
    const dates = parseFomcCalendar(HTML).map((m) => m.date);
    expect(dates).toEqual(["2021-11-03", "2023-02-01", "2023-03-22", "2026-01-28", "2026-03-18"]);
  });

  it("处理跨月写法 Jan/Feb + 31-1", () => {
    expect(parseFomcCalendar(HTML).some((m) => m.date === "2023-02-01")).toBe(true);
  });

  it("处理星号 17-18*", () => {
    expect(parseFomcCalendar(HTML).some((m) => m.date === "2026-03-18")).toBe(true);
  });

  it("空 HTML 不报错", () => {
    expect(parseFomcCalendar("")).toEqual([]);
  });
});
