const types={csv:'text/csv',pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
export const coachFileAccept=Object.keys(types).map(ext=>'.'+ext).join(',');
export function coachFileType(name){return types[String(name).split('.').pop().toLowerCase()]||''}
export function validCoachFile(name,bytes){
 const type=coachFileType(name);
 const starts=(...prefix)=>prefix.every((byte,i)=>bytes[i]===byte);
 switch(type){
  case 'text/csv':return bytes.length>0&&!bytes.includes(0);
  case 'application/pdf':return starts(37,80,68,70,45);
  case 'image/jpeg':return starts(255,216,255);
  case 'image/png':return starts(137,80,78,71,13,10,26,10);
  case 'image/webp':return starts(82,73,70,70)&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP';
  default:return false;
 }
}
