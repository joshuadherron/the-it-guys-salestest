import { query } from './db.js';

// Requested in Quick Quote walkthrough fixes v1, task 3 (2026-10-24).
// Only already-authorized queued Sends advance; advance() rechecks actor/hold,
// claims the durable per-job lease, and refuses uncertain email replay.
export function startQuickSendWorker({run=query,service,interval=setInterval,clear=clearInterval,warn=console.warn}={}){
  let running=false;
  const tick=async()=>{
    if(running)return;
    running=true;
    try{
      const jobs=await run("SELECT quote_id FROM quote_quick_sends WHERE status IN ('Queued','Prepared','Sending') ORDER BY updated_at,quote_id LIMIT 100");
      const sender=service||(await import('./quick-send-runtime.js')).quickSend;
      for(const job of jobs){
        try{await sender.advance(job.quote_id);}catch(error){warn('Quick Send worker paused:',{quoteId:job.quote_id,message:error.message});}
      }
    }catch(error){warn('Quick Send worker unavailable:',{message:error.message});}
    finally{running=false;}
  };
  const timer=interval(()=>{void tick();},30000);timer.unref?.();
  const ready=tick();
  return {ready,tick,stop:()=>clear(timer)};
}
