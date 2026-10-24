const quickForm=document.querySelector('[data-quick-quote]');
if(quickForm){
  const sync=()=>{
    const value=name=>quickForm.elements.namedItem(name);
    if(value('onboardingFee')&&value('onboarding'))value('onboardingFee').value=value('onboarding').value;
    const fee=quickForm.querySelector('#approved-onboarding-fee');if(fee&&value('onboarding'))fee.value='$'+Number(value('onboarding').value||0).toFixed(2);
    const confirmation=quickForm.querySelector('#device-confirmation');if(confirmation&&value('computers'))confirmation.hidden=Number(value('computers').value)>0;
    if(value('factsOnsiteHours')&&value('onsiteHours'))value('factsOnsiteHours').value=value('onsiteHours').value;
  };
  quickForm.addEventListener('input',sync);quickForm.addEventListener('submit',sync);
  const add=quickForm.querySelector('[data-quick-add]');
  if(add)add.addEventListener('click',()=>{
    const body=quickForm.querySelector('[data-quick-lines]'),row=body.lastElementChild.cloneNode(true);
    for(const input of row.querySelectorAll('input'))input.value=input.name==='line_quantity'?'1':input.name==='line_unitPrice'?'0':'';
    body.append(row);
  });
}
const sendForm=document.querySelector('[data-quick-send]');
if(sendForm){
  const button=sendForm.querySelector('button');
  sendForm.addEventListener('change',()=>{button.textContent=sendForm.querySelector('input[name^="stop_"]:checked')?'Send anyway':button.dataset.sendLabel;});
}
const progressForm=document.getElementById('quick-progress-form');
if(progressForm){
  let running=false;
  const advance=async()=>{
    if(running)return;running=true;
    try{
      const response=await fetch(progressForm.action,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(new FormData(progressForm))});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Send paused. Return to the quote for the next action.');
      if(result.done||result.waitingApproval||result.status==='Failed'){window.location.reload();return;}
      document.getElementById('quick-progress').textContent=({record_requested:'Setting up client folder…',record_ready:'Creating quote copy…',copy_requested:'Creating quote copy…',copy_ready:'Filling quote…',filled:'Sending…'})[result.step]||'Sending…';
      if(result.manualRequestId){
        document.getElementById('quick-reconcile').hidden=false;
        const form=document.getElementById('quick-confirm-absent');if(form)form.action='/requests/'+encodeURIComponent(result.manualRequestId)+'/reconcile';
        return;
      }
      running=false;setTimeout(advance,3000);
    }catch(error){document.getElementById('quick-error').textContent=error.message+' Return to the quote or request history to resolve it.';}
  };
  advance();
}
