const business=document.querySelector('select[name="business_id"]');
const name=document.getElementById("business_name");
if(business&&name) {
  const update=()=>{
    const selected=business.selectedOptions[0];
    name.readOnly=!!business.value;
    if(business.value)name.value=selected.dataset.businessName;
  };
  business.addEventListener("change",update);update();
}
