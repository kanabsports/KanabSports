export async function onRequest(context) {
  const response = await context.next();
  const url = new URL(context.request.url);
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('text/html')) return response;

  let html = await response.text();

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const tickerMarkup = `
<div id="recentScoresShell" class="scores-ticker-shell" hidden>
  <div class="wrap scores-ticker">
    <div class="scores-ticker-label">Recent Scores</div>
    <div id="recentScoresTrack" class="scores-ticker-track" aria-label="Recent scores"></div>
  </div>
</div>
<div id="championCelebration" class="champion-celebration" hidden aria-hidden="true">
  <div id="championConfetti" class="champion-confetti" aria-hidden="true"></div>
  <div class="champion-card" role="dialog" aria-modal="true" aria-labelledby="championTitle">
    <button id="championClose" class="champion-close" type="button" aria-label="Close celebration">×</button>
    <div class="champion-kicker">Kanab Sports</div>
    <div class="champion-trophy">🏆</div>
    <h2 id="championTitle">STATE CHAMPIONS!</h2>
    <p id="championMessage"></p>
    <button id="championDone" class="champion-done" type="button">LET'S GO!</button>
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
.champion-celebration{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:rgba(6,7,9,.76);backdrop-filter:blur(7px);padding:18px}
.champion-celebration[hidden]{display:none}
.champion-card{position:relative;z-index:2;width:min(520px,100%);background:#0b0c0f;color:#fff;border:1px solid #333640;border-radius:24px;padding:34px 26px 28px;text-align:center;box-shadow:0 30px 100px rgba(0,0,0,.5)}
.champion-close{position:absolute;right:14px;top:10px;border:0;background:transparent;color:#aeb1b8;font-size:32px;line-height:1;cursor:pointer;padding:8px}
.champion-kicker{color:#e32636;font-size:11px;font-weight:950;letter-spacing:2px;text-transform:uppercase}
.champion-trophy{font-size:58px;line-height:1;margin:16px 0 10px}
.champion-card h2{font-size:clamp(42px,10vw,72px);line-height:.88;letter-spacing:-2.5px;margin:0;text-transform:uppercase;font-weight:950}
.champion-card p{font-size:18px;line-height:1.45;color:#d1d3d8;margin:20px auto 0;max-width:410px}
.champion-done{margin-top:24px;border:0;border-radius:11px;background:#e32636;color:#fff;padding:14px 22px;font-size:12px;font-weight:950;letter-spacing:1px;cursor:pointer}
.champion-confetti{position:fixed;inset:0;z-index:1;overflow:hidden;pointer-events:none}
.confetti-piece{position:absolute;top:-24px;width:10px;height:18px;border-radius:2px;opacity:.95;animation:championFall linear forwards}
@keyframes championFall{0%{transform:translate3d(0,-30px,0) rotate(0deg)}100%{transform:translate3d(var(--drift),110vh,0) rotate(var(--spin))}}
@media(max-width:620px){.scores-ticker{min-height:48px}.scores-ticker-label{padding:0 13px;font-size:9px}.score-tick{padding:0 15px;font-size:12px;gap:7px}.champion-card{padding:30px 18px 24px}.champion-trophy{font-size:50px}.champion-card p{font-size:16px}}
</style>`;

    const tickerScript = `
<script id="recentScoresScript">
(function(){
  const shell=document.getElementById('recentScoresShell');
  const track=document.getElementById('recentScoresTrack');
  const celebration=document.getElementById('championCelebration');
  const championMessage=document.getElementById('championMessage');
  const confetti=document.getElementById('championConfetti');
  const closeButton=document.getElementById('championClose');
  const doneButton=document.getElementById('championDone');
  if(!shell||!track)return;

  const esc=(value)=>String(value??'').replace(/[&<>\"']/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[ch]));
  const parseDate=(value)=>{const d=new Date(value+'T12:00:00');return Number.isNaN(d.getTime())?null:d};

  function showChampions(c){
    if(!celebration||!championMessage||!confetti||!c)return;
    const team=String(c.team||'Kanab');
    const sport=String(c.sport||'');
    const opponent=String(c.opponent||'');
    const hasScore=Number.isFinite(Number(c.teamScore))&&Number.isFinite(Number(c.opponentScore));
    const score=hasScore?' '+c.teamScore+'–'+c.opponentScore:'';
    championMessage.textContent=team+' are your '+(sport?sport+' ':'')+'state champions!'+(opponent?' '+team+' defeated '+opponent+score+'.':'');
    celebration.hidden=false;
    celebration.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
    confetti.innerHTML='';
    const colors=['#e32636','#ffffff','#f1b63b','#111318','#e32636','#ffffff'];
    for(let i=0;i<120;i++){
      const p=document.createElement('i');
      p.className='confetti-piece';
      p.style.left=(Math.random()*100)+'vw';
      p.style.background=colors[i%colors.length];
      p.style.width=(6+Math.random()*8)+'px';
      p.style.height=(9+Math.random()*15)+'px';
      p.style.animationDuration=(2.8+Math.random()*3.2)+'s';
      p.style.animationDelay=(Math.random()*1.4)+'s';
      p.style.setProperty('--drift',((-100+Math.random()*200))+'px');
      p.style.setProperty('--spin',((360+Math.random()*1080))+'deg');
      confetti.appendChild(p);
    }
  }

  function closeChampions(){
    if(!celebration)return;
    celebration.hidden=true;
    celebration.setAttribute('aria-hidden','true');
    document.body.style.overflow='';
    if(confetti)confetti.innerHTML='';
  }
  closeButton&&closeButton.addEventListener('click',closeChampions);
  doneButton&&doneButton.addEventListener('click',closeChampions);
  celebration&&celebration.addEventListener('click',(e)=>{if(e.target===celebration)closeChampions();});
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape')closeChampions();});

  fetch('/api/scores',{headers:{'Accept':'application/json'},cache:'no-store'})
    .then(r=>r.ok?r.json():Promise.reject(new Error('scores unavailable')))
    .then(data=>{
      if(data?.celebration)showChampions(data.celebration);

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
        const hs=esc(s.home_score??s.teamScore??s.score_for??'');
        const as=esc(s.away_score??s.opponentScore??s.score_against??'');
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
  }

  if (url.pathname === '/coaches.html' || url.pathname === '/coaches') {
    const turnstileGuard = `
<script id="coachTurnstileGuard">
(function(){
  const form=document.getElementById('coachForm');
  const button=document.getElementById('submitButton');
  const status=document.getElementById('coachStatus');
  const widget=document.querySelector('.cf-turnstile');
  if(!form||!button||!status||!widget)return;

  let resetAttempted=false;
  const tokenInput=()=>form.querySelector('input[name="cf-turnstile-response"]');
  const tokenReady=()=>Boolean(tokenInput()&&tokenInput().value);

  function sync(){
    if(tokenReady()){
      if(status.textContent==='Waiting for verification…') status.textContent='';
      return true;
    }
    return false;
  }

  form.addEventListener('submit',function(event){
    if(sync()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    status.textContent='Waiting for verification…';
    button.disabled=false;
    if(window.turnstile&&typeof window.turnstile.reset==='function'){
      try{window.turnstile.reset(widget);}catch(e){}
    }
  },true);

  const poll=setInterval(()=>{
    if(sync()){
      clearInterval(poll);
      return;
    }
  },250);

  setTimeout(()=>{
    if(!tokenReady()&&!resetAttempted&&window.turnstile&&typeof window.turnstile.reset==='function'){
      resetAttempted=true;
      try{window.turnstile.reset(widget);}catch(e){}
    }
  },10000);

  window.addEventListener('pageshow',()=>{
    if(!tokenReady()&&window.turnstile&&typeof window.turnstile.reset==='function'){
      try{window.turnstile.reset(widget);}catch(e){}
    }
  });
})();
</script>`;
    if (!html.includes('id="coachTurnstileGuard"')) html = html.replace('</body>', turnstileGuard + '\n</body>');
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
