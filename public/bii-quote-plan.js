document.querySelectorAll('[data-bii-plan]').forEach(panel=>{
  function update(){
    const operating=panel.querySelector('[data-operating-business]').checked;
    const assessed=panel.querySelector('[data-assessed]').checked;
    panel.querySelector('[data-operating-fields]').hidden=!operating;
    panel.querySelector('[data-assessment-date]').hidden=!assessed;
    panel.querySelector('[data-assessment-hint]').hidden=!operating||assessed;
    const waves=Number(panel.querySelector('[data-wave-count]').value);
    const days=Number.isSafeInteger(waves)&&waves>=1&&waves<=Number.MAX_SAFE_INTEGER-12?12+waves:'—';
    panel.querySelector('[data-bii-plan-length]').textContent=`Plan length: 11 + W + 1 = ${days} business days`;
  }
  panel.addEventListener('input',update);panel.addEventListener('change',update);update();
});
