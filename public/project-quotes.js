for(const form of document.querySelectorAll("[data-project-quote]")) {
  const rows=form.querySelector("[data-quote-lines]");
  form.querySelector("[data-add-quote-line]").addEventListener("click",()=>{
    if(rows.children.length>=100)return;
    const row=rows.firstElementChild.cloneNode(true);
    for(const input of row.querySelectorAll("input")){if(input.type==="checkbox")input.checked=false;else input.value=input.name==="line_quantity"?"1":input.name==="line_unitPrice"?"0":"";}
    rows.append(row);
  });
}
