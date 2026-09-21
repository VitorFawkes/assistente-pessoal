/** The intentionally small JSON Schema subset used by coach outputs and read tools. */
export type CoachJsonSchema = Record<string, unknown>;
const supported = new Set(['type','properties','required','additionalProperties','items','enum','const','anyOf','minLength','maxLength','pattern','minItems','maxItems','minimum','maximum','description','title']);
const record = (value:unknown):value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value);
export function validCoachSchema(schema:unknown, depth=0):schema is CoachJsonSchema {
 if(!record(schema)||depth>30||Object.keys(schema).some(key=>!supported.has(key)))return false;
 if(schema.anyOf!==undefined&&(!Array.isArray(schema.anyOf)||!schema.anyOf.length||!schema.anyOf.every(s=>validCoachSchema(s,depth+1))))return false;
 if(schema.type!==undefined&&!['object','array','string','integer','number','boolean','null'].includes(String(schema.type)))return false;
 if(schema.type===undefined&&schema.anyOf===undefined)return false;
 if(schema.enum!==undefined&&(!Array.isArray(schema.enum)||!schema.enum.length||schema.enum.some(record)))return false;
 if(schema.type==='object'&&(!record(schema.properties)||schema.additionalProperties!==false||!Array.isArray(schema.required)||schema.required.some(k=>typeof k!=='string'||!Object.hasOwn(schema.properties as object,k))||!Object.values(schema.properties).every(s=>validCoachSchema(s,depth+1))))return false;
 if(schema.type==='array'&&!validCoachSchema(schema.items,depth+1))return false;
 for(const key of ['minLength','maxLength','minItems','maxItems','minimum','maximum'])if(schema[key]!==undefined&&(typeof schema[key]!=='number'||!Number.isFinite(schema[key])))return false;
 if(schema.pattern!==undefined){if(typeof schema.pattern!=='string'||schema.pattern.length>500)return false;try{new RegExp(schema.pattern);}catch{return false;}}
 return true;
}
export function matchesCoachSchema(value:unknown,schema:CoachJsonSchema,depth=0):boolean {
 if(depth>40)return false;
 if(Array.isArray(schema.anyOf)&&!schema.anyOf.some(s=>matchesCoachSchema(value,s as CoachJsonSchema,depth+1)))return false;
 if(Array.isArray(schema.enum)&&!schema.enum.some(v=>JSON.stringify(v)===JSON.stringify(value)))return false;
 if(Object.hasOwn(schema,'const')&&JSON.stringify(schema.const)!==JSON.stringify(value))return false;
 if(schema.type==='object'){
  if(!record(value))return false;
  const properties=schema.properties as Record<string,CoachJsonSchema>;
  if((schema.required as string[]).some(k=>!Object.hasOwn(value,k)))return false;
  return Object.entries(value).every(([k,v])=>Object.hasOwn(properties,k)&&matchesCoachSchema(v,properties[k],depth+1));
 }
 if(schema.type==='array')return Array.isArray(value)&&!(typeof schema.minItems==='number'&&value.length<schema.minItems)&&!(typeof schema.maxItems==='number'&&value.length>schema.maxItems)&&value.every(v=>matchesCoachSchema(v,schema.items as CoachJsonSchema,depth+1));
 if(schema.type==='string')return typeof value==='string'&&!(typeof schema.minLength==='number'&&value.length<schema.minLength)&&!(typeof schema.maxLength==='number'&&value.length>schema.maxLength)&&!(typeof schema.pattern==='string'&&!new RegExp(schema.pattern).test(value));
 if(schema.type==='integer'||schema.type==='number')return typeof value==='number'&&Number.isFinite(value)&&(schema.type!=='integer'||Number.isInteger(value))&&!(typeof schema.minimum==='number'&&value<schema.minimum)&&!(typeof schema.maximum==='number'&&value>schema.maximum);
 if(schema.type==='boolean')return typeof value==='boolean';
 if(schema.type==='null')return value===null;
 return schema.anyOf!==undefined;
}
/** Anthropic rejects these constraints on the wire. They remain mandatory locally. */
export function anthropicSchema(schema:CoachJsonSchema):CoachJsonSchema {
 const result:CoachJsonSchema={};const constraints:string[]=[];
 for(const [key,value] of Object.entries(schema)){
  if(['minimum','maximum','minLength','maxLength','maxItems'].includes(key)||(key==='minItems'&&Number(value)>1)){constraints.push(`${key}: ${value}`);continue;}
  if(key==='properties')result[key]=Object.fromEntries(Object.entries(value as Record<string,CoachJsonSchema>).map(([name,s])=>[name,anthropicSchema(s)]));
  else if(key==='items')result[key]=anthropicSchema(value as CoachJsonSchema);
  else if(key==='anyOf')result[key]=(value as CoachJsonSchema[]).map(anthropicSchema);
  else result[key]=value;
 }
 if(constraints.length)result.description=[result.description,`Required constraints: ${constraints.join('; ')}.`].filter(Boolean).join(' ');
 return result;
}
