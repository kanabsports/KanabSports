// Shared by the browser and message API. This is Pep's language policy, not a legal classifier.
export const LANGUAGE_NOTE = 'Words in red cannot be sent through Pep Talks. Please choose a different word.';
const words = ['motherfuckers','motherfucker','motherfucking','motherfucked','fuckers','fucker','fucking','fucked','fucks','fuck','bullshitting','bullshit','shitting','shitty','shits','shit','assholes','asshole','cunts','cunt','goddamned','goddamn','twats','twat','bitches','bitching','bitch','bastards','bastard','dickheads','dickhead','douchebags','douchebag','wankers','wanker','sluts','slut','whores','whore'];
const equivalents = {a:'[a@4]',i:'[i1!|]',o:'[o0]',s:'[s$5]',t:'[t7]',e:'[e3]',u:'[uü]'};
const gap = '[\\s\\p{P}\\p{Cf}_]*';
const pattern = words.map(word => [...word].map(c => (equivalents[c] || c) + '+').join(gap)).join('|');
export function findBlockedWords(input){
  const original=String(input || ''); let normalized='', offsets=[];
  let position=0;
  for(const char of original){
    const converted=char.normalize('NFKC').toLowerCase();
    for(let j=0;j<converted.length;j++)offsets.push({start:position,end:position+char.length});
    normalized+=converted;position+=char.length;
  }
  const regex=new RegExp('(?<![\\p{L}\\p{N}])(?:'+pattern+')(?![\\p{L}\\p{N}])','gu');
  return [...normalized.matchAll(regex)].map(m=>({start:offsets[m.index].start,end:offsets[m.index+m[0].length-1].end}));
}
