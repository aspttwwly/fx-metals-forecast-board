import test from "node:test";
import assert from "node:assert/strict";
import { FREQUENCIES, selectForecast, validateHorizon, forecastCsv } from "../src/forecast-frequency.js";

function fixture() {
  const origin = "2026-10-09";
  const weekly = Array.from({length:53}, (_,h) => ({date:new Date(Date.UTC(2026,9,9+h*7)).toISOString().slice(0,10),
    actual:h===0?7:null, forecast:7+h*.01, future:h>0, horizon:h, lower:null, upper:null}));
  const monthly = Array.from({length:13}, (_,h) => ({date:new Date(Date.UTC(2026,9+h,0)).toISOString().slice(0,10),
    actual:h===0?8:null, forecast:8-h*.02, future:h>0, horizon:h, lower:null, upper:null}));
  return {symbol:"TEST", modelVersion:"weekly", sourceUpdatedAt:"2026-10-15", generatedAt:"2026-10-15",
    latestActual:{date:origin,value:7}, series:weekly.slice(0,14), files:{forecast:"weekly.xlsx"},
    forecastScope:"CURRENT_DECISION_CHAIN_AS_ISSUED", terrain:{state:"UP"}, modelAdmission:{status:"ELIGIBLE"},
    longHorizon:{issuedAt:"2026-10-15T01:00:00Z",sourceDataCutoff:"2026-10-14",
      weekly:{series:weekly,originDate:origin,prefixDisplayEqual:true,policyVersion:"extended"},
      monthly:{status:"RESEARCH_ONLY",modelVersion:"monthly",policyVersion:"monthly-v1",series:monthly,
        latestActual:{date:"2026-09-30",value:8}, note:"independent monthly"}}};
}

test("defaults are thirteen weeks and three months", () => {
  assert.equal(FREQUENCIES.weekly.defaultHorizon,13); assert.equal(FREQUENCIES.monthly.defaultHorizon,3);
  assert.equal(selectForecast(fixture()).series.filter(p=>p.future).length,13);
});
test("all selected periods have exactly the requested number of future points", () => {
  for (const [freq,max] of [["weekly",52],["monthly",12]]) {
    for (let h=1;h<=max;h++) assert.equal(selectForecast(fixture(),freq,h).series.filter(p=>p.future).length,h);
  }
});
test("weekly 52 preserves original 13 without mutating source", () => {
  const original=fixture(), before=JSON.stringify(original);
  const a=selectForecast(original,"weekly",13), b=selectForecast(original,"weekly",52);
  assert.deepEqual(b.series.slice(0,14),a.series);
  assert.equal(JSON.stringify(original),before);
});
test("monthly is an independent forecast and cannot inherit weekly governance", () => {
  const data=selectForecast(fixture(),"monthly",3);
  assert.equal(data.nextForecast.date,"2026-10-31"); assert.equal(data.selectedEnd.date,"2026-12-31");
  assert.equal(data.direction,"下行"); assert.equal(selectForecast(fixture()).direction,"上行");
  for (const key of ["modelAdmission","forecastEvidence","replayEvidence","terrain","tradeSignal","modelMonitor"]) assert.equal(data[key],null);
});
test("range validation rejects empty, fractional and non-finite values", () => {
  for (const freq of ["weekly","monthly"]) for (const value of ["", " ", 0, -1, 1.5, "abc", Infinity, NaN, 53]) {
    assert.throws(()=>validateHorizon(freq,value));
  }
  assert.throws(()=>validateHorizon("monthly",13));
});
test("missing or stale research data is an error, never synthesized or silently replaced", () => {
  const data=fixture(); delete data.longHorizon;
  assert.throws(()=>selectForecast(data,"monthly",3),/月频/);
  assert.throws(()=>selectForecast(data,"weekly",52),/长周频/);
  assert.equal(selectForecast(data,"weekly",13).selectedHorizon,13);
  const stale=fixture(); stale.longHorizon.weekly.originDate="2026-10-02";
  assert.throws(()=>selectForecast(stale,"weekly",14));
});
test("CSV contains the displayed range, independent frequency and research status", () => {
  const month=forecastCsv(selectForecast(fixture(),"monthly",3));
  assert.equal(month.split("\r\n").length,4);
  assert.match(month,/MONTHLY_RESEARCH/); assert.match(month,/2026-12-31/); assert.doesNotMatch(month,/2027-01-31/);
  const week=forecastCsv(selectForecast(fixture(),"weekly",52));
  assert.equal(week.split("\r\n").length,53); assert.match(week,/WEEKLY_RESEARCH_EXTENSION/);
});
