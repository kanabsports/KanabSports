export const TEAM_D={code:'TEAM-D',name:'Team D Soccer',sport:'Youth Soccer',season:'Fall 2026',coaches:['Britt Roth','Jodi Palmer'],headCoach:'Amber Hooper',url:'/team/britt/',events:[
{date:'2026-09-28',time:'6:45 PM',type:'game',title:'vs Team B',detail:'Rhees Jackson'},
{date:'2026-10-05',time:'6:45 PM',type:'game',title:'vs Team A',detail:'Amber Hooper'},
{date:'2026-10-12',time:'6:45 PM',type:'game',title:'vs Team C',detail:'Tami Van Dyke'},
{date:'2026-10-26',time:'6:00 PM',type:'game',title:'vs Team B',detail:'Rhees Jackson'},
{date:'2026-11-02',time:'6:45 PM',type:'game',title:'vs Team A',detail:'Amber Hooper'}],players:[
{grade:'3rd',name:'Logan Welch'},{grade:'3rd',name:'Verity Henke'},{grade:'3rd',name:'Lennon Brown'},{grade:'3rd',name:'Kelby Wheeler'},{grade:'3rd',name:'Nora LeFevre'},
{grade:'4th',name:'Harper Penney'},{grade:'4th',name:'Grai Reese'},{grade:'4th',name:'Carter Bunting'},
{grade:'5th',name:'Yotam Binyamini'},{grade:'5th',name:'Finn Roth'},{grade:'5th',name:'Bryson Palmer'}]};
export const teamPlayer=name=>TEAM_D.players.find(p=>p.name.toLowerCase()===String(name).toLowerCase()||(p.name==='Verity Henke'&&String(name).toLowerCase()==='verity rose henke'));
