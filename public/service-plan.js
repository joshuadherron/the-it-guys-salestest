for(const form of document.querySelectorAll('form[action$="/handoff"]')) {
  const sequence=form.querySelector("[data-service-sequence]");
  if(!sequence)continue;
  const start=sequence.querySelector("select"),reason=sequence.querySelector("[data-sequence-reason]"),input=reason.querySelector("textarea");
  const update=()=>{
    const both=form.querySelector('input[name="service_scope"]:checked')?.value==="BII + Managed IT";
    sequence.hidden=!both;
    const exception=both&&start.value==="Managed IT"&&!start.disabled;
    reason.hidden=!exception;input.required=exception;input.disabled=!exception;
  };
  form.addEventListener("change",update);update();
}
