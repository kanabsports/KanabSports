export async function onRequest(context){
  const response=await context.next();
  if(context.request.method!=='GET')return response;
  const type=response.headers.get('content-type')||'';
  if(!type.includes('text/html'))return response;
  const script=`<script id="approvedCoachSports">
(function(){
  function esc(v){return String(v||'').replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]})}
  function pretty(v){return String(v||'Sport').replace(/-/g,' ').replace(/\\b\\w/g,function(m){return m.toUpperCase()})}
  fetch('/api/public-teams',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
    var teams=Array.isArray(d.teams)?d.teams:[],grid=document.getElementById('sportGrid');if(!grid||!teams.length)return;
    teams.slice().reverse().forEach(function(t){
      var key=t.key||'',teamKey=t.teamKey||'',selector='a[href*="sport='+CSS.escape(key)+'"]';
      var existing=grid.querySelector(selector);
      if(existing&&(!teamKey||existing.href.indexOf('team=')<0)){
        existing.href='/team.html?sport='+encodeURIComponent(key)+'&team='+encodeURIComponent(teamKey);
        var meta=existing.querySelector('.sport-meta');if(meta)meta.textContent='View team page →';
        return;
      }
      var stale=[].slice.call(grid.querySelectorAll('.sport.stale')).find(function(x){return (x.querySelector('.sport-name')?.textContent||'').toLowerCase().includes(String(t.sport||'').toLowerCase())});if(stale)stale.remove();
      var a=document.createElement('a');a.className='sport';a.href='/team.html?sport='+encodeURIComponent(key)+'&team='+encodeURIComponent(teamKey);
      a.innerHTML='<div><div class="sport-name">'+esc(t.name||pretty(t.sport))+'</div><div class="sport-next"><strong>Approved coach update</strong>'+(t.season?'<br>'+esc(t.season):'')+'</div></div><div class="sport-meta">View team page →</div>';
      grid.appendChild(a);
    });
  }).catch(function(){});
})();
</script>`;
  const html=await response.text();
  const body=html.includes('</body>')?html.replace('</body>',script+'</body>'):html+script;
  const headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');
  return new Response(body,{status:response.status,statusText:response.statusText,headers});
}
