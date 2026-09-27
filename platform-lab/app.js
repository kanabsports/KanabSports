(() => {
  const ORGS = {
    kanab: {
      id: "org_kanab_001", slug: "kanab", name: "Kanab Sports", type: "Community sports",
      mode: "REFERENCE", crest: "KS", color: "#e32636", soft: "#fff0f2",
      tagline: "Production reference tenant · read-only inside this lab",
      sms: { start: 100, used: 31.40, texts: 1046, system: 318, avgCost: 0.03 },
      admins: [
        {name:"Platform Owner", role:"Platform admin"},
        {name:"Kanab Sports Admin", role:"Organization admin"}
      ],
      texters: [
        {name:"Coach Britt", team:"Rec Girls Team D", count:186},
        {name:"Head Coach", team:"Rec Soccer", count:142},
        {name:"Coach Casey", team:"Youth Soccer", count:88},
        {name:"System", team:"Automated reminders", count:318},
        {name:"Admin", team:"Organization", count:61}
      ],
      teams: [
        {sport:"Soccer",name:"Rec Girls Team D",members:12,status:"Active"},
        {sport:"Football",name:"Kanab Cowboys",members:42,status:"Active"},
        {sport:"Basketball",name:"Boys Rec Basketball",members:28,status:"Registration"}
      ],
      audit:[
        "Reference tenant loaded into lab",
        "Messaging ledger separated by organization_id",
        "No production writes allowed from Platform Lab"
      ]
    },
    wizard: {
      id: "org_lab_wizard_002", slug: "wizard", name: "Hogsmeade Sports", type: "School + town rec",
      mode: "LAB TOWN 2", crest: "HP", color: "#7c2d3a", soft: "#f8edf0",
      tagline: "A little magic, a lot of ordinary sports administration.",
      sms: { start: 100, used: 78.25, texts: 2608, system: 524, avgCost: 0.03 },
      admins: [
        {name:"Albus Dumbledore", role:"Principal"},
        {name:"Minerva McGonagall", role:"Athletic director"}
      ],
      texters: [
        {name:"Harry Potter",team:"Gryffindor Soccer",count:621},
        {name:"Hermione Granger",team:"Hogsmeade Basketball",count:408},
        {name:"Ron Weasley",team:"Gryffindor Soccer",count:331},
        {name:"Minerva McGonagall",team:"School-wide",count:229},
        {name:"Severus Snape",team:"Track",count:173}
      ],
      teams: [
        {sport:"Soccer",name:"Gryffindor Soccer",members:18,status:"Active"},
        {sport:"Basketball",name:"Hogsmeade Hoops",members:24,status:"Active"},
        {sport:"Track",name:"Hogwarts Track",members:31,status:"Upcoming"}
      ],
      audit:[
        "75% messaging warning simulated",
        "Harry Potter sent a team announcement",
        "Principal dashboard viewed"
      ]
    },
    jedi: {
      id: "org_lab_jedi_003", slug: "jedi", name: "Jedi Town Athletics", type: "School + rec league",
      mode: "LAB TOWN 3", crest: "JT", color: "#2b6cb0", soft: "#eaf3fb",
      tagline: "Calm dashboard. Strong permissions. No disturbance in the data.",
      sms: { start: 100, used: 92.10, texts: 3070, system: 610, avgCost: 0.03 },
      admins: [
        {name:"Leia Organa", role:"Principal"},
        {name:"Obi-Wan Kenobi", role:"Athletic director"}
      ],
      texters: [
        {name:"Luke Skywalker",team:"Jedi Academy Soccer",count:782},
        {name:"Ahsoka Tano",team:"Temple Basketball",count:477},
        {name:"Obi-Wan Kenobi",team:"School-wide",count:322},
        {name:"Yoda",team:"Youth Training",count:264},
        {name:"Leia Organa",team:"Administration",count:173}
      ],
      teams: [
        {sport:"Soccer",name:"Jedi Academy Soccer",members:20,status:"Active"},
        {sport:"Basketball",name:"Temple Basketball",members:22,status:"Active"},
        {sport:"Cross Country",name:"Rebel Runners",members:17,status:"Upcoming"}
      ],
      audit:[
        "90% messaging invoice trigger simulated",
        "Luke Skywalker sent a team announcement",
        "Cross-tenant write was rejected"
      ]
    }
  };

  const state = JSON.parse(JSON.stringify(ORGS));
  const money = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
  const pct = n => Math.max(0,Math.min(100,n));
  const qs = s => document.querySelector(s);
  const initials = name => name.split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase();
  const orgById = id => Object.values(state).find(o => o.id === id);

  function usageState(org){
    const percent = org.sms.used/org.sms.start*100;
    if(percent >= 90) return {label:"Invoice due", cls:"danger", issues:1};
    if(percent >= 75) return {label:"Attention", cls:"warn", issues:1};
    return {label:"Healthy", cls:"", issues:0};
  }

  function renderConsole(){
    const grid = qs("#orgGrid");
    if(!grid) return;
    const orgs = Object.values(state);
    qs("#orgCount").textContent = orgs.length;
    qs("#issueCount").textContent = orgs.reduce((n,o)=>n+usageState(o).issues,0);
    qs("#creditTotal").textContent = money(orgs.reduce((n,o)=>n+(o.sms.start-o.sms.used),0));

    grid.innerHTML = orgs.map(function(o){
      const u=usageState(o);
      const remaining=o.sms.start-o.sms.used;
      const percent=o.sms.used/o.sms.start*100;
      return '<article class="org-card" style="--tenant-color:'+o.color+';--tenant-soft:'+o.soft+'">'+
        '<div class="org-card-head"><div class="org-badge">'+o.crest+'</div><span class="state '+u.cls+'">'+u.label+'</span></div>'+
        '<h3>'+o.name+'</h3>'+
        '<p class="org-sub">'+o.type+' · '+o.mode+'</p>'+
        '<div class="org-meta">'+
          '<div><span>SMS left</span><strong>'+money(remaining)+'</strong></div>'+
          '<div><span>Usage</span><strong>'+percent.toFixed(0)+'%</strong></div>'+
          '<div><span>Teams</span><strong>'+o.teams.length+'</strong></div>'+
          '<div><span>Texts sent</span><strong>'+o.sms.texts.toLocaleString()+'</strong></div>'+
        '</div>'+
        '<a class="org-link" href="/platform-lab/tenant.html?org='+o.slug+'">Open organization →</a>'+
      '</article>';
    }).join("");

    const btn=qs("#runTestsBtn");
    if(btn) btn.addEventListener("click",runIsolationTests);
  }

  function runIsolationTests(){
    const tests = [];
    const check = function(name, detail, fn){
      let ok=false;
      try{ ok=!!fn(); }catch(e){ ok=false; }
      tests.push({name:name,detail:detail,ok:ok});
    };

    const readTeam = function(requestingOrgId, recordOrgId, teamName){
      return requestingOrgId===recordOrgId ? {teamName:teamName,organization_id:recordOrgId} : null;
    };
    const writeUsage = function(requestingOrgId, targetOrgId, amount){
      if(requestingOrgId!==targetOrgId) return false;
      const org=orgById(targetOrgId);
      if(!org) return false;
      org.sms.used += amount;
      return true;
    };
    const brandRead = function(requestingOrgId,targetOrgId){
      return requestingOrgId===targetOrgId ? (orgById(targetOrgId) || {}).color : null;
    };

    check("Town 2 cannot read Kanab teams","Wizard tenant asks for a Kanab-owned team record.",function(){return readTeam(state.wizard.id,state.kanab.id,"Rec Girls Team D")===null;});
    check("Town 3 cannot read Town 2 teams","Jedi tenant asks for a Hogsmeade-owned team record.",function(){return readTeam(state.jedi.id,state.wizard.id,"Gryffindor Soccer")===null;});
    check("Cross-town SMS write is rejected","Town 2 attempts to spend Town 3 messaging credit.",function(){return writeUsage(state.wizard.id,state.jedi.id,1)===false;});
    check("Kanab lab record stays read-only","Town 3 attempts to change the Kanab lab ledger.",function(){return writeUsage(state.jedi.id,state.kanab.id,1)===false;});
    check("Branding is tenant-scoped","Town 2 cannot fetch Town 3 brand token.",function(){return brandRead(state.wizard.id,state.jedi.id)===null;});
    check("Same-town access still works","Town 3 can read a Town 3-owned record.",function(){return !!readTeam(state.jedi.id,state.jedi.id,"Jedi Academy Soccer");});

    const results=qs("#testResults");
    results.innerHTML=tests.map(function(t){
      return '<div class="test-row '+(t.ok?'':'fail')+'">'+
        '<div class="test-icon">'+(t.ok?'✓':'!')+'</div>'+
        '<div><strong>'+t.name+'</strong><small>'+t.detail+'</small></div>'+
        '<em>'+(t.ok?'Blocked correctly':'Needs work')+'</em>'+
      '</div>';
    }).join("");

    const pass=tests.filter(function(t){return t.ok;}).length;
    qs("#testScore").textContent=pass+"/"+tests.length;
    qs("#testBadge").textContent=pass===tests.length?"All passed":"Review failures";
    qs("#testBadge").style.background=pass===tests.length?"#e9f7f1":"#fff0ee";
    qs("#testBadge").style.color=pass===tests.length?"#11875d":"#b42318";
    qs("#isolationSummary").textContent=pass===tests.length?"Isolation checks passed":"Isolation issue found";
  }

  function getTenant(){
    const slug = new URLSearchParams(location.search).get("org") || "wizard";
    return state[slug] || state.wizard;
  }

  function renderTenant(){
    if(!qs("#tenantHero")) return;
    const o=getTenant();
    document.documentElement.style.setProperty("--tenant",o.color);
    document.documentElement.style.setProperty("--tenant-soft",o.soft);
    document.title=o.name+" · Platform Lab";
    qs("#tenantCrest").textContent=o.crest;
    qs("#tenantName").textContent=o.name;
    qs("#tenantType").textContent=o.type;
    qs("#tenantMode").textContent=o.mode;
    qs("#tenantTagline").textContent=o.tagline;
    qs("#orgIdLabel").textContent="organization_id: "+o.id;
    refreshTenant(o);

    qs("#simulateText").addEventListener("click",function(){
      const cost=0.42, segments=14;
      o.sms.used=Math.min(o.sms.start,o.sms.used+cost);
      o.sms.texts+=segments;
      const coach=o.texters.find(function(x){return x.name!=="System";}) || o.texters[0];
      coach.count+=segments;
      o.audit.unshift(coach.name+" simulated a "+segments+"-segment team message");
      refreshTenant(o);
      toast("Simulated "+segments+" texts for "+money(cost)+" — only "+o.name+" changed.");
    });

    qs("#addTeamBtn").addEventListener("click",function(){
      const n=o.teams.length+1;
      o.teams.push({sport:"Test sport",name:"Lab Team "+n,members:0,status:"Draft"});
      o.audit.unshift("Lab Team "+n+" created inside "+o.id);
      refreshTenant(o);
      toast("Test team added only to this organization.");
    });

    qs("#tryCrossRead").addEventListener("click",function(){
      const other=Object.values(state).find(function(x){return x.id!==o.id;});
      toast("Blocked: "+o.name+" cannot read "+other.name+" records.");
      o.audit.unshift("Cross-tenant read to "+other.id+" blocked");
      refreshTenant(o);
    });

    qs("#supportBtn").addEventListener("click",function(){
      o.audit.unshift("24-hour support-view request simulated · audited");
      refreshTenant(o);
      toast("Temporary support access request logged. No permanent impersonation.");
    });
  }

  function refreshTenant(o){
    const remaining=Math.max(0,o.sms.start-o.sms.used);
    const percent=pct(o.sms.used/o.sms.start*100);
    const u=usageState(o);
    qs("#smsRemaining").textContent=money(remaining);
    qs("#smsProgress").style.width=percent+"%";
    qs("#smsUsed").textContent=percent.toFixed(1)+"% used";
    qs("#smsBudget").textContent=money(o.sms.start)+" starting credit";
    qs("#textsSent").textContent=o.sms.texts.toLocaleString();
    qs("#textsLeft").textContent=Math.max(0,Math.floor(remaining/o.sms.avgCost)).toLocaleString();
    qs("#systemTexts").textContent=o.sms.system.toLocaleString();
    qs("#smsStatus").textContent=u.label;
    qs("#smsStatus").className="status-chip "+u.cls;

    const alert=qs("#smsAlert");
    if(percent>=90){
      alert.className="alert-box show danger";
      alert.innerHTML="<strong>90% threshold crossed.</strong> In production, Kanab Sports would email the admin and automatically create the messaging-credit invoice.";
    }else if(percent>=75){
      alert.className="alert-box show warn";
      alert.innerHTML="<strong>75% usage alert.</strong> In production, the school admin would receive an email plus this dashboard warning.";
    }else{
      alert.className="alert-box";
      alert.innerHTML="";
    }

    const total=o.texters.reduce(function(n,x){return n+x.count;},0) || 1;
    qs("#topTexters").innerHTML=o.texters.slice().sort(function(a,b){return b.count-a.count;}).slice(0,5).map(function(x){
      return '<div class="texter">'+
        '<div class="avatar">'+initials(x.name)+'</div>'+
        '<div><strong>'+x.name+'</strong><small>'+x.team+'</small></div>'+
        '<div class="texter-count"><strong>'+x.count.toLocaleString()+'</strong><small>'+Math.round(x.count/total*100)+'% of listed</small></div>'+
      '</div>';
    }).join("");

    qs("#teamGrid").innerHTML=o.teams.map(function(t){
      return '<div class="team-card"><div class="sport">'+t.sport+'</div><h3>'+t.name+'</h3><div class="team-meta"><span>'+t.members+' members</span><span>'+t.status+'</span></div></div>';
    }).join("");

    qs("#adminList").innerHTML=o.admins.map(function(a){
      return '<div class="admin"><div><strong>'+a.name+'</strong><small>'+a.role+'</small></div><span>Active</span></div>';
    }).join("");

    qs("#auditList").innerHTML=o.audit.slice(0,5).map(function(a){
      return '<div class="audit"><strong>'+a+'</strong><small>Tenant: '+o.id+'</small></div>';
    }).join("");
  }

  let toastTimer;
  function toast(msg){
    const el=qs("#toast");
    if(!el) return;
    el.textContent=msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer=setTimeout(function(){el.classList.remove("show");},2600);
  }

  if(document.body.dataset.page==="console") renderConsole();
  if(document.body.dataset.page==="tenant") renderTenant();
})();