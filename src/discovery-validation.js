import {schema,ownership} from './discovery-rules.js';
import {choice,text,integer,fail} from './security.js';
export function validateAnswer(id,cell){const q=schema.find(q=>q.id===id);if(!q)fail('Unknown question.');if(!cell||typeof cell!=='object')fail('Invalid answer.');choice(cell.state,['answered','not_sure','not_discussed']);if(cell.state!=='answered')return {state:cell.state,value:null};let v=cell.value;
if(q.type==='matrix'){const result={};for(const row of ['domain','admin']){const c=v?.[row];choice(c?.state,['answered','not_sure','not_discussed']);result[row]={state:c.state,value:c.state==='answered'?choice(c.value,row==='domain'?ownership:ownership.slice(0,3)):null};}v=result;}
else if(q.type==='apps'){if(v?.none===true)v={none:true,entries:[]};else {if(!Array.isArray(v?.entries)||!v.entries.length||v.entries.length>30)fail('Add an application or select None.');v={none:false,entries:v.entries.map(e=>{const name=text(e.name,200);if(!name)fail('Application name required.');return {name,use:text(e.use||'',1000),hosting:choice(e.hosting,['Cloud-based','Installed on computers or a server','Not sure','Not discussed'])};})};}}
else if(q.type==='volume'){v={amount:integer(v?.amount,1000000000),unit:choice(v?.unit,['GB','TB'])};}
else if(q.type==='billing'){v=v?.same?{same:true}:{answer:text(v?.answer||'',1000)};if(!v.same&&!v.answer)fail('Enter the billing contact.');}
else if(q.type==='multi'){if(!Array.isArray(v)||!v.length)fail('Select at least one option.');v=[...new Set(v.map(x=>choice(x,q.options)))];}
else if(q.follow){const selected=choice(v?.answer,q.options);let detail='';if(selected===q.follow.when){if(q.follow.type==='number')detail=integer(v.detail);else if(q.follow.type==='devices')detail=choice(v.detail,['phones','computers','both']);else detail=text(v.detail||'',5000);}v={answer:selected,detail};}
else if(q.type==='select')v=choice(v,q.options);
else if(q.type==='number')v=integer(v);
else {v=text(v,10000);if(!v)fail('Enter an answer or choose a state.');if(q.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))fail('Enter a valid email address.');}
return {state:'answered',value:v};}
