import { afterEach, expect, test } from "bun:test";
import { analysisSchema, coachCompletion, CoachAIError } from "./model";
const originalFetch=globalThis.fetch;const originalKey=process.env.OPENAI_API_KEY;
afterEach(()=>{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;});
test("AI request does not store personal context and uses strict output schema",async()=>{
 process.env.OPENAI_API_KEY="synthetic-key";let payload:Record<string,unknown>={};
 globalThis.fetch=(async(_url:unknown,init?:RequestInit)=>{payload=JSON.parse(String(init?.body));return Response.json({choices:[{finish_reason:"stop",message:{content:'{"summary":"ok","observations":[]}'}}]});}) as unknown as typeof fetch;
 expect(await coachCompletion("analyze",{text:"synthetic"},analysisSchema)).toEqual({summary:"ok",observations:[]});
 expect(payload.store).toBe(false);expect(payload.response_format).toMatchObject({type:"json_schema",json_schema:{strict:true}});
});
test("provider errors never expose remote body or key",async()=>{
 process.env.OPENAI_API_KEY="synthetic-key";globalThis.fetch=(async()=>new Response("private provider trace",{status:500})) as unknown as typeof fetch;
 try{await coachCompletion("",{},analysisSchema);throw new Error("should fail");}catch(error){expect(error).toBeInstanceOf(CoachAIError);expect((error as Error).message).not.toContain("private provider trace");}
});
test("truncated responses and refusal cannot be persisted as completed output",async()=>{
 process.env.OPENAI_API_KEY="synthetic-key";globalThis.fetch=(async()=>Response.json({choices:[{finish_reason:"length",message:{content:'{"summary":"partial"}'}}]})) as unknown as typeof fetch;
 await expect(coachCompletion("",{},analysisSchema)).rejects.toBeInstanceOf(CoachAIError);
});
