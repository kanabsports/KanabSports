const $=id=>document.getElementById(id);
const id=new URLSearchParams(location.search).get('id')||'',url='/api/score-details?id='+encodeURIComponent(id);
let revision,photo,reader;
async function request(body){
 const r=await fetch(url,{method:body?'POST':'GET',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const data=await r.json();if(!r.ok)throw Error(data.error||'Could not reach the score.');return data;
}
try{
 const data=await request();
 if(!id){
  $('state').textContent=data.games.length?'Choose the final score to update.':'No published scores found for your team.';
  for(const g of data.games){const p=document.createElement('p'),a=document.createElement('a');a.href='?id='+encodeURIComponent(g.id);a.textContent=[g.event_date,g.team+' vs. '+g.opponent,g.result].join(' · ');p.append(a);$('state').after(p);}
 }else{revision=data.revision;$('details').value=data.details;$('state').textContent='';$('stats').hidden=false;}
}catch(e){$('state').textContent=e.message}
function loadReader(){
 if(!reader)reader=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  script.integrity='sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F';script.crossOrigin='anonymous';
  script.onload=resolve;script.onerror=()=>reject(Error('Reader unavailable'));document.head.append(script);
 }).catch(e=>{reader=null;throw e});
 return reader;
}
$('picture').onchange=async()=>{
 const file=$('picture').files[0];if(!file)return;
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>12*1024*1024){$('state').textContent='Choose a PNG, JPG or WebP up to 12 MB.';return}
 if($('details').value.trim()&&!confirm('Replace the draft with text from this screenshot?'))return;
 if(photo)URL.revokeObjectURL(photo);photo=URL.createObjectURL(file);$('preview').src=photo;$('preview').hidden=false;
 $('picture').disabled=$('save').disabled=$('details').disabled=true;$('state').textContent='Reading the screenshot on this device…';
 let worker;
 try{
  await loadReader();worker=await Tesseract.createWorker('eng',1,{workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0',langPath:'https://tessdata.projectnaptha.com/4.0.0'});
  await worker.setParameters({preserve_interword_spaces:'1'});
  const {data}=await worker.recognize(file);if(!data.text.trim())throw Error('Empty text');
  $('details').value=data.text.trim();$('state').textContent='Compare the draft with the screenshot, correct any errors, then publish.';
 }catch{$('state').textContent='Could not read this image. Try a clearer crop or type the game stats below.'}
 finally{$('picture').disabled=$('save').disabled=$('details').disabled=false;if(worker)await worker.terminate()}
};
$('stats').onsubmit=async e=>{
 e.preventDefault();$('save').disabled=true;
 try{const data=await request({details:$('details').value,revision});revision=data.revision;$('publicLink').href='/game-stats.html?id='+encodeURIComponent(id);$('publicLink').hidden=false;$('state').textContent='Game stats published.'}
 catch(e){$('state').textContent=e.message}finally{$('save').disabled=false}
};
