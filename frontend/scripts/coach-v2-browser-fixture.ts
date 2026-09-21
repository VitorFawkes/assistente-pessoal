/** Synthetic browser QA only. Refuses every DB except local coach_qa. Never reads production. */
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFile,writeFile,chmod } from "node:fs/promises";
const url=new URL(process.env.COACH_QA_DATABASE_URL||"");
if(!["localhost","127.0.0.1"].includes(url.hostname)||url.pathname!=="/coach_qa")throw new Error("Only a local dedicated coach_qa database is allowed.");
const output=process.env.COACH_QA_FIXTURE_OUTPUT||"/tmp/acoes-coach-v2-browser-fixture.json";
if(!output.startsWith("/tmp/")&&!output.startsWith("/private/tmp/"))throw new Error("Fixture credentials must stay outside the repository in /tmp.");
const db=new Pool({connectionString:url.toString(),max:1});
const user=randomUUID(),other=randomUUID(),person=randomUUID(),otherPerson=randomUUID();
const session=randomUUID(),otherSession=randomUUID();const now=new Date();
const meetings=[
 {id:randomUUID(),title:"Fictícia · alinhamento comercial",ago:1,turns:[
  {speaker:"A",start:0,end:28,text:"Minha prioridade desta semana é concluir a proposta comercial do Projeto Aurora. O cliente precisa receber amanhã. Vou deixar a nova tela da plataforma para depois e delegar a revisão visual para Clara."},
  {speaker:"B",start:29,end:49,text:"A proposta está quase pronta. Você só precisa aprovar o escopo; a tela nova pode esperar até a próxima semana."},
  {speaker:"A",start:50,end:90,text:"Eu entendo. Mesmo assim comecei ontem uma automação nova e abri três ajustes sem responsável. Hoje vou aprovar o escopo antes de retomar a automação. Clara pode decidir o visual sem minha aprovação."}]},
 {id:randomUUID(),title:"Fictícia · revisão de delegação",ago:72,turns:[
  {speaker:"A",start:0,end:40,text:"Na semana passada revisei sozinho todos os detalhes. Agora combinei com Clara o resultado esperado e um ponto de acompanhamento, sem exigir aprovação de cada etapa. A entrega foi concluída no prazo."},
  {speaker:"B",start:41,end:59,text:"Funcionou melhor quando ficou claro qual decisão era minha. O único bloqueio foi receber o acesso ao painel."},
  {speaker:"A",start:60,end:85,text:"Vou registrar os acessos necessários antes de delegar. Não quero concluir que toda dificuldade seja falta de autonomia; neste caso havia um bloqueio de acesso."}]}
];
try{
 // Load a schema-only snapshot only for an empty QA database. Data dumps are refused.
 if(!(await db.query("SELECT to_regclass('public.users') AS present")).rows[0].present){
  const schemaPath=process.env.COACH_QA_SCHEMA_FILE;
  if(!schemaPath)throw new Error("Empty QA database: provide COACH_QA_SCHEMA_FILE with a reviewed schema-only dump.");
  const source=await readFile(schemaPath,"utf8");
  if(/^COPY .+ FROM stdin;|^INSERT INTO/im.test(source))throw new Error("A schema-only dump is required; row data is forbidden.");
  const schema=source.split("\n").filter(line=>!line.startsWith("\\")&&!line.startsWith("ALTER DEFAULT PRIVILEGES FOR ROLE assistente ")).join("\n");
  await db.query(schema);
 }
 await db.query("SET search_path=public");
 await db.query("GRANT USAGE ON SCHEMA public TO app_tenant,app_writer; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO app_tenant,app_writer;");
 for(const name of ["0015_tarefa_frentes.sql","0028_leadership_coach.sql","0029_coach_memory_lifecycle.sql","0030_coach_jobs.sql","0031_coach_retrieval.sql"]){
  await db.query(await readFile(new URL(`../../db/${name}`,import.meta.url),"utf8"));
 }
 await db.query("BEGIN");
 await db.query("INSERT INTO users(id,nome,consent_terms_at) VALUES($1,'Líder Exemplo QA',now()),($2,'Outro Usuário QA',now())",[user,other]);
 await db.query("INSERT INTO sessions(id,user_id,user_agent) VALUES($1,$2,'Synthetic coach browser QA'),($3,$4,'Synthetic other tenant QA')",[session,user,otherSession,other]);
 await db.query("INSERT INTO pessoas(id,user_id,nome,is_vitor) VALUES($1,$2,'Líder Exemplo QA',true),($3,$4,'Outro Usuário QA',true)",[person,user,otherPerson,other]);
 for(const m of meetings){const transcript=m.turns.map(t=>`${t.speaker}: ${t.text}`).join("\n");await db.query(`INSERT INTO meetings(id,user_id,source,original_filename,nome,recorded_at,status,transcription,segments,speaker_labels,speaker_pessoas,summary,duration_seconds)
 VALUES($1,$2,'macbook','synthetic-qa.mp3',$3,$4,'done',$5,$6::jsonb,$7::jsonb,$8::jsonb,'Exemplo fictício para testes de liderança, priorização e delegação.',90)`,[m.id,user,m.title,new Date(now.getTime()-m.ago*3600000).toISOString(),transcript,JSON.stringify(m.turns),JSON.stringify({A:"Líder Exemplo QA",B:"Clara Fictícia"}),JSON.stringify({A:person})]);}
 const privateMeeting=randomUUID();await db.query(`INSERT INTO meetings(id,user_id,source,original_filename,nome,recorded_at,status,transcription,segments,speaker_pessoas) VALUES($1,$2,'macbook','other-synthetic.mp3','Fictícia privada outro tenant',now(),'done','SEGREDO_OUTRO_TENANT_QA_87223','[]','{}')`,[privateMeeting,other]);
 await db.query("INSERT INTO tarefas(user_id,meeting_id,titulo,descricao,owner,status,prioridade,prazo,acao) VALUES($1,$2,'Aprovar escopo da proposta Aurora','Compromisso fictício com prazo real na fixture','vitor','aberta','alta',$3,'executar'),($1,$2,'Criar nova tela da plataforma','Sem cliente ou prazo bloqueado; pode esperar','vitor','aberta','media',NULL,'executar')",[user,meetings[0].id,new Date(now.getTime()+24*3600000).toISOString()]);
 await db.query("INSERT INTO coach_profiles(user_id,enabled,weekly_enabled,goals,context) VALUES($1,true,false,'Concluir uma prioridade relevante antes de iniciar outra frente.','Contexto inteiramente fictício para QA; múltiplos projetos de tecnologia e vendas.'),($2,false,false,'Meta confidencial de outro tenant QA.','SEGREDO_OUTRO_TENANT_QA_87223')",[user,other]);
 await db.query("INSERT INTO coach_memories(user_id,kind,content,status,origin) VALUES($1,'goal','Concluir uma prioridade relevante antes de iniciar outra frente.','confirmed','user')",[user]);
 await db.query("COMMIT");
 await writeFile(output,JSON.stringify({user,other,session,otherSession,meetingIds:meetings.map(m=>m.id),privateMeeting,created_at:now.toISOString()},null,2),{mode:0o600});await chmod(output,0o600);
 console.log(JSON.stringify({ok:true,synthetic:true,users:2,meetings:3,credentials_file:output}));
}catch(error){await db.query("ROLLBACK");throw error;}finally{await db.end();}
