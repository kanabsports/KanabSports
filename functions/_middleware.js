export async function onRequest(context) {
  const response = await context.next();
  const url = new URL(context.request.url);
  const contentType = response.headers.get('content-type') || '';

  if ((url.pathname !== '/' && url.pathname !== '/index.html') || !contentType.includes('text/html')) {
    return response;
  }

  let html = await response.text();

  const tickerMarkup = `
<div id="recentScoresShell" class="scores-ticker-shell" hidden>
  <div class="wrap scores-ticker">
    <div class="scores-ticker-label">Recent Scores</div>
    <div id="recentScoresTrack" class="scores-ticker-track" aria-label="Recent scores"></div>
  </div>
</div>`;

  const tickerStyles = `
<style id="recentScoresStyles">
.scores-ticker-shell{background:#fff;border-top:1px solid #e5e5e2;border-bottom:1px solid #e5e5e2;overflow:hidden}
.scores-ticker{display:flex;align-items:stretch;overflow:hidden;min-height:50px}
.scores-ticker-label{flex:0 0 auto;background:#0b0c0f;color:#fff;padding:0 20px;display:flex;align-items:center;font-size:10px;font-weight:950;letter-spacing:1.35px;text-transform:uppercase;z-index:2;white-space:nowrap}
.scores-ticker-track{display:flex;flex:1 1 auto;min-width:0;overflow-x:auto;scrollbar-width:none;touch-action:pan-x;-webkit-overflow-scrolling:touch}
.scores-ticker-track::-webkit-scrollbar{display:none}
.score-tick{flex:0 0 auto;display:flex;align-items:center;gap:9px;padding:0 20px;border-right:1px solid #eee;white-space:nowrap;font-size:13px;color:#444}
.score-tick .score-sport{font-size:10px;font-weight:950;letter-spacing:.8px;text-transform:uppercase;color:#777}
.score-tick .score-team{font-weight:850;color:#16171a}
.score-tick .score-result{font-weight:950;color:#e32636}
.score-tick .score-final{font-size:10px;font-weight:900;letter-spacing:.7px;color:#8a8c92;text-transform:uppercase}
@media(max-width:620px){.scores-ticker{min-height:48px}.scores-ticker-label{padding:0 13px;font-size:9px}.score-tick{padding:0 15px;font-size:12px;gap:7px}}
</style>`;

  const tickerScript = `
<script id="recentScoresScript">
(function(){
  const shell=document.getElementById('recentScoresShell');
  const track=document.getElementById('recentScoresTrack');
  if(!shell||!track)return;

  const esc=(value)=>String(value??'').replace(/[&<>\"']/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[ch]));
  const parseDate=(value)=>{const d=new Date(value+'T12:00:00');return Number.isNaN(d.getTime())?null:d};

  fetch('/api/scores',{headers:{'Accept':'application/json'}})
    .then(r=>r.ok?r.json():Promise.reject(new Error('scores unavailable')))
    .then(data=>{
      const cutoff=new Date();cutoff.setHours(0,0,0,0);cutoff.setDate(cutoff.getDate()-14);
      const scores=(Array.isArray(data?.scores)?data.scores:[])
        .filter(s=>{
          const d=parseDate(s.date);
          return d&&d>=cutoff&&s.status!=='pending';
        })
        .sort((a,b)=>String(b.date).localeCompare(String(a.date)))
        .slice(0,12);

      if(!scores.length)return;

      const markup=scores.map(s=>{
        const sport=esc(s.sport||'Score');
        const home=esc(s.home_team||s.team||'Kanab');
        const away=esc(s.away_team||s.opponent||'Opponent');
        const hs=esc(s.home_score??s.score_for??'');
        const as=esc(s.away_score??s.score_against??'');
        const date=parseDate(s.date);
        const dateLabel=date?date.toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
        return '<div class="score-tick"><span class="score-sport">'+sport+'</span><span class="score-team">'+home+'</span><span class="score-result">'+hs+' — '+as+'</span><span class="score-team">'+away+'</span><span class="score-final">Final'+(dateLabel?' · '+dateLabel:'')+'</span></div>';
      }).join('');

      track.innerHTML=markup+markup;
      shell.hidden=false;

      let paused=false,pauseTimer;
      const pause=()=>{paused=true;clearTimeout(pauseTimer);pauseTimer=setTimeout(()=>paused=false,3000)};
      track.addEventListener('touchstart',pause,{passive:true});
      track.addEventListener('pointerdown',pause);
      setInterval(()=>{
        if(paused||track.scrollWidth<=track.clientWidth)return;
        track.scrollLeft+=1;
        const half=Math.floor(track.scrollWidth/2);
        if(track.scrollLeft>=half)track.scrollLeft-=half;
      },40);
    })
    .catch(()=>{});
})();
</script>`;

  if (!html.includes('id="recentScoresShell"')) {
    html = html.replace('</head>', tickerStyles + '\n</head>');
    html = html.replace('<section class="section" id="registration">', tickerMarkup + '\n<section class="section" id="registration">');
    html = html.replace('</body>', tickerScript + '\n</body>');
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
