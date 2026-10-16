import test from "node:test";
import assert from "node:assert/strict";
import {chicagoDate,chicagoLongDate} from "../src/docfill/chicago-date.js";
test("Chicago date is previous day after midnight UTC in October",()=>{
 assert.equal(chicagoDate("2026-10-16T01:33:00Z"),"2026-10-15");
 assert.equal(chicagoLongDate("2026-10-16T01:33:00Z"),"October 15, 2026");
});
test("Chicago business day observes standard time",()=>{
 assert.equal(chicagoDate("2026-12-16T05:33:00Z"),"2026-12-15");
});
