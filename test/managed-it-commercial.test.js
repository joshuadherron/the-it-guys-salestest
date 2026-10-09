import test from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import { completionFlags, availableFlags, mayComplete, openItem, workPayload } from '../src/work-items.js';
import { nextStep } from '../src/next-step.js';
import { clientData } from '../src/guided-workflow.js';
const owner={role:'owner',email:'josh@theitguys.us'};
const item={id:'41',workflowId:'MIT-05',lane:'Managed IT',stage:'Quoting',status:'',blocking:true,signatureRequired:false,document:'Managed IT Quote'};
const defs=[{id:'MIT-17',lane:'Managed IT',active:true,triggerMode:'Outcome flag',triggerFlag:'BAA required',document:'BAA'}];
const choices=['BAA required'];
const client={'Service Lanes':['Managed IT'],'Current Stage':'Quoting',HIPAA:true};
test('HIPAA automatically adds BAA on Managed IT quote and preserves payload shape',()=>{
 const flags=completionFlags(defs,choices,item,client,owner);
 assert.deepEqual(workPayload('ItemCompleted',{client_id:'CL-1'},item.lane,{itemId:41,outcomeFlags:flags}),{itemId:41,completionStatus:'Complete',outcomeFlags:['BAA required']});
 assert.deepEqual(completionFlags(defs,choices,item,client,owner,['BAA required']),['BAA required']);
});
test('BAA never applies to BII or other Managed IT items, including mixed-lane clients',()=>{
 for(const target of [{...item,lane:'Business IT Integration',workflowId:'BII-16'},{...item,workflowId:'MIT-06'}]){
  assert.deepEqual(completionFlags(defs,choices,target,client,owner),[]);
  assert.throws(()=>completionFlags(defs,choices,target,client,owner,['BAA required']));
 }
});
test('manual owner override without HIPAA; sales cannot override',()=>{
 assert.deepEqual(completionFlags(defs,choices,item,{HIPAA:false},owner,['BAA required']),['BAA required']);
 assert.throws(()=>completionFlags(defs,choices,item,{HIPAA:false},{role:'sales'},['BAA required']));
});
test('BAA requires active definition and library choice',()=>{
 assert.deepEqual(completionFlags([{...defs[0],active:false}],choices,item,client,owner),[]);
 assert.deepEqual(completionFlags(defs,[],item,client,owner),[]);
 assert.deepEqual(availableFlags([{...defs[0],active:false}],['Managed IT']),[]);
});
test('live client HIPAA checkbox uses mapped internal name',()=>{
 const maps=Object.fromEntries(['Client ID','Current Stage','Stage Status','Next Action','Service Lanes'].map(k=>[k,{name:k}]));
 maps.HIPAA={name:'CustomHipaa'};
 assert.equal(clientData({fields:{CustomHipaa:true}},{maps:{clients:maps}}).HIPAA,true);
});
async function panel(hipaa=true){
 return ejs.renderFile('views/workflow-panel.ejs',{user:owner,mode:'dryrun',csrf:'token',p:{id:1,client_id:'CL-1'},d:{status:'Ready for Review'},step:{title:'Review',detail:''},clientRecord:{...client,HIPAA:hipaa},items:[item],itemGroups:[{label:'Current stage',items:[item]}],requests:[],pending:[],error:null,schema:{errors:[],workChoices:{TIG_OutcomeFlags:choices}},currentStage:'Quoting',stageGateNotice:false,completedGroups:8,hasAnswers:true,flags:defs,definitions:[],mayComplete,openItem,stageChoices:[],actionErrors:{}});
}
test('MIT-05 quote acceptance button, confirmation and locked HIPAA flag',async()=>{
 const html=await panel();
 assert.ok(html.includes('Quote accepted in writing / Mark won'));
 assert.ok(html.includes('Confirm the client accepted this Quote in writing and the acceptance is saved in /Commercial. This moves the client to Contracting and issues the MSA and Client Service Schedule.'));
 assert.match(html,/value="BAA required" checked disabled/);
 assert.doesNotMatch(await panel(false),/value="BAA required" checked disabled/);
});

test('MIT-05 next step requests written quote acceptance',()=>{
 const step=nextStep({id:1,client_id:'CL-1',service_lane:'Managed IT'},{status:'Ready for Review'},[],client,[item],[],'owner');
 assert.equal(step.title,'Get quote accepted');
 assert.equal(step.detail,'Open the quote to review/send it. After the client accepts it in writing, save the acceptance in /Commercial, then mark it accepted below.');
});
