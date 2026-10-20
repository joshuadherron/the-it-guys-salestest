import test from "node:test";
import assert from "node:assert/strict";
import { applyServicePlan, servicePlan, validateServicePlan, bothServices } from "../src/service-plan.js";
import { discoverySnapshot } from "../src/discovery-export.js";
import { emptyAnswers } from "../src/discovery-rules.js";
const owner={role:"owner"},sales={role:"sales"};

test("both services defaults to BII first, including for sales",()=>{
  const plan=validateServicePlan({service_scope:bothServices},sales);
  assert.deepEqual(plan,{services:["Business IT Integration","Managed IT"],startingLane:"Business IT Integration",reason:""});
});
test("Josh may choose Managed IT first with a timing reason",()=>{
  const plan=validateServicePlan({service_scope:bothServices,starting_service_lane:"Managed IT",service_sequence_reason:"Client needs support before the BII project can be scheduled."},owner);
  assert.equal(plan.startingLane,"Managed IT");assert.equal(plan.services.length,2);assert.match(plan.reason,/support/);
});
test("sales cannot forge the timing exception",()=>{
  assert.throws(()=>validateServicePlan({service_scope:bothServices,starting_service_lane:"Managed IT",service_sequence_reason:"We need it immediately."},sales),/Josh/);
});
for(const reason of ["","urgent",[]])test(`invalid timing reason ${JSON.stringify(reason)} is refused`,()=>{
  assert.throws(()=>validateServicePlan({service_scope:bothServices,starting_service_lane:"Managed IT",service_sequence_reason:reason},owner));
});
test("single-service choices ignore an irrelevant first-workflow value",()=>{
  assert.deepEqual(validateServicePlan({service_scope:"Managed IT",starting_service_lane:"Business IT Integration"},sales),{services:["Managed IT"],startingLane:"Managed IT",reason:""});
  assert.equal(validateServicePlan({service_lane:"Business IT Integration"},sales).startingLane,"Business IT Integration");
});
test("invalid scope or workflow cannot be sent to SharePoint",()=>{
  assert.throws(()=>validateServicePlan({service_scope:"Both",starting_service_lane:"Managed IT"},owner));
  assert.throws(()=>validateServicePlan({service_scope:bothServices,starting_service_lane:["Managed IT","Business IT Integration"]},owner));
});
test("stored plans round trip without changing the active lane or sales signal",()=>{
  const p={service_lane:"Business IT Integration",likely_service:"Other"};
  const plan=validateServicePlan({service_scope:bothServices},owner),saved=applyServicePlan(p,plan);
  assert.equal(servicePlan(saved).scope,bothServices);assert.equal(saved.service_lane,p.service_lane);assert.equal(saved.likely_service,"Other");
  assert.equal(servicePlan({service_lane:"Managed IT"}).services[0],"Managed IT");
});
test("discovery captures both services but legacy exports retain their existing fields",()=>{
  const d={answers:emptyAnswers(),status:"Ready for Review",revision:1},p={opp:"OPP-0080"};
  assert.equal(discoverySnapshot(p,d).servicePlan,undefined);
  const saved=applyServicePlan(p,validateServicePlan({service_scope:bothServices},owner));
  const snapshot=discoverySnapshot(saved,d);
  assert.deepEqual(snapshot.servicePlan.services,["Business IT Integration","Managed IT"]);
  assert.equal(snapshot.servicePlan.startingLane,"Business IT Integration");
});
