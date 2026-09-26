const file=document.querySelector('#csv-file');if(file)file.addEventListener('change',async()=>{document.querySelector('#csv-content').value=await file.files[0].text();});
