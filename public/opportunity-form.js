const business=document.querySelector('select[name="business_id"]');
const name=document.getElementById("business_name");
if(business&&name) {
  const modes=Array.from(document.querySelectorAll('input[name="business_mode"]'));
  const chooser=document.querySelector('[data-existing-business]');
  const contacts=[name,...['contact_name','email','phone'].map(id=>document.getElementById(id)).filter(Boolean)];
  let draft=contacts.map(field=>field.value);
  let previousMode=modes.find(mode=>mode.checked)?.value||"existing";
  const update=()=>{
    const mode=modes.find(option=>option.checked)?.value||"existing";
    if(mode==="existing"&&previousMode==="new")draft=contacts.map(field=>field.value);
    business.disabled=mode==="new";
    business.required=mode==="existing";
    if(chooser)chooser.hidden=mode==="new";
    if(mode==="new") {
      if(previousMode==="existing")contacts.forEach((field,index)=>field.value=draft[index]);
      business.value="";
      name.readOnly=false;
      previousMode=mode;
      return;
    }
    const selected=business.selectedOptions[0];
    name.readOnly=!!business.value;
    if(business.value&&selected) {
      name.value=selected.dataset.businessName;
      for(const [id,key] of [['contact_name','contactName'],['email','email'],['phone','phone']]) {
        const field=document.getElementById(id);
        if(field)field.value=selected.dataset[key]||"";
      }
    }
    previousMode=mode;
  };
  modes.forEach(mode=>mode.addEventListener("change",update));
  business.addEventListener("change",update);update();
}
