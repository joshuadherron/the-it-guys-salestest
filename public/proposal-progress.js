const proposalForm=document.getElementById("proposal-save");
if(proposalForm){
  let running=false;
  const progress=document.getElementById("proposal-progress"),error=document.getElementById("proposal-error"),button=proposalForm.querySelector("button");
  const advance=async()=>{
    if(running)return;
    running=true;button.disabled=true;error.textContent="";
    try{
      const response=await fetch(proposalForm.action,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams(new FormData(proposalForm))});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Save could not continue. Review the request history and resume.");
      progress.textContent=result.step;
      if(result.done){window.location.assign(proposalForm.action.replace(/\/prepare$/,"/delivery"));return;}
      running=false;
      setTimeout(advance,3000);
    }catch(e){error.textContent=e.message;running=false;button.disabled=false;}
  };
  proposalForm.addEventListener("submit",e=>{e.preventDefault();advance();});
  if(proposalForm.dataset.run==="yes")advance();
}
