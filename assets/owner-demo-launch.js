(() => {
 const button=document.getElementById('ownerCoachPreview');if(!button)return;
 button.onclick=async()=>{
  button.disabled=true;const status=document.getElementById('ownerDemoStatus');status.textContent='Opening your demo team…';
  const post=async body=>{const r=await fetch('/api/owner-demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;};
  try{await post({action:'remember'});const d=await post({role:'head'});location.href=d.url;}
  catch(e){status.textContent=e.message;button.disabled=false;}
 };
})();
