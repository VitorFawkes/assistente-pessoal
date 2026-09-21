const stamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const dateKey=/^(?:current_time|now|prazo|from|to|at|.*_at|valid_from|valid_until)$/;
/** Format known timestamp fields before inference; never reinterpret a date-only deadline or quoted prose. */
export function localContextDates(data:unknown,timezone:string):unknown{
 const formatter=new Intl.DateTimeFormat("pt-BR",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
 const seen=new WeakMap<object,unknown>();
 const visit=(value:unknown):unknown=>{
  if(value===null||typeof value!=="object")return value;
  if(value instanceof Date)return value.toISOString();
  if(seen.has(value))return seen.get(value);
  if(Array.isArray(value)){const result:unknown[]=[];seen.set(value,result);for(const item of value)result.push(visit(item));return result;}
  const result:Record<string,unknown>={};seen.set(value,result);
  for(const [key,item] of Object.entries(value)){
   result[key]=visit(item);
   const iso=item instanceof Date?item.toISOString():item;
   if(dateKey.test(key)&&typeof iso==="string"&&stamp.test(iso)&&Number.isFinite(Date.parse(iso)))result[key+"_local"]=formatter.format(new Date(iso))+" ("+timezone+")";
  }
  return result;
 };
 return visit(data);
}
export function contextTimezone(data:unknown):string{
 const row=data&&typeof data==="object"?data as Record<string,unknown>:{};
 const wrapped=row.data&&typeof row.data==="object"?row.data as Record<string,unknown>:{};
 const evidence=typeof row.timezone==="string"||row.profile?row:wrapped;
 const profile=evidence.profile&&typeof evidence.profile==="object"?evidence.profile as Record<string,unknown>:{};
 const value=typeof evidence.timezone==="string"?evidence.timezone:typeof profile.timezone==="string"?profile.timezone:"America/Sao_Paulo";
 try{new Intl.DateTimeFormat("pt-BR",{timeZone:value});return value;}catch{return "America/Sao_Paulo";}
}
