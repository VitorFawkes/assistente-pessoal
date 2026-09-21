import type { Coverage, Observation } from "./types";

/** Persist the evidence distinction, independently of the model's prose. */
export function presentChat(answer:string,observations:Observation[],selectedMeetingIds:string[],coverage:Coverage,reportCount=0){
 const meetingCount=new Set(selectedMeetingIds).size;
 const chunkCount=selectedMeetingIds.length;
 const readings=observations.map(observation=>[
  `**Observação:** ${observation.observation}`,
  `**Hipótese:** ${observation.hypothesis||"Ainda não há hipótese sustentada por estes trechos."}`,
  `**Outra explicação:** ${observation.alternative||"Falta contexto para descartar outras explicações."}`,
  ...(observation.experiment?[`**Experimento:** ${observation.experiment}`]:[]),
 ].join("\n\n"));
 const retrieval=chunkCount
  ? `Consultei ${chunkCount} ${chunkCount===1?"trecho":"trechos"} de ${meetingCount} ${meetingCount===1?"reunião":"reuniões"} nesta resposta; essa seleção não representa todo o histórico.`
  : "Não consultei trechos de reuniões nesta resposta.";
 const reportReading=reportCount?` Consultei relatórios/resumos de ${reportCount} ${reportCount===1?"reunião":"reuniões"}; contexto gerado não equivale a evidência comportamental.`:"";
 const coverageAtCreation=coverage.report_ready_meetings!==undefined?`Na geração desta resposta: ${coverage.report_ready_meetings} de ${coverage.total_meetings} reuniões do histórico com relatório/resumo disponível; ${coverage.analyzed_meetings} com análise comportamental integral anterior.`:`Na geração desta resposta: ${coverage.analyzed_meetings} de ${coverage.total_meetings} ${coverage.total_meetings===1?"reunião":"reuniões"} do histórico com análise completa.`;
 return [
  `**Orientação**\n\n${answer}`,
  ...(readings.length
   ? [...readings,"Uma fala registrada não comprova execução. Hipóteses e explicações alternativas podem ser corrigidas por você."]
   : ["Sem observações verificadas sobre sua conduta nas reuniões. A orientação parte do contexto disponível e do que você relatou."]),
  `*${retrieval}${reportReading} ${coverageAtCreation}*`,
 ].join("\n\n");
}

export function splitChatPresentation(content:string):{answer:string;reading:string;scope:string}{
 const prefix="**Orientação**\n\n";
 if(!content.startsWith(prefix))return {answer:content,reading:"",scope:""};
 const body=content.slice(prefix.length);
 // Only split the server-generated envelope. Ordinary/older Markdown stays intact.
 const scopeStart=body.search(/\n\n\*(?:Consultei \d+|Não consultei trechos de reuniões nesta resposta\.)/u);
 const main=scopeStart>=0?body.slice(0,scopeStart):body;
 const scope=scopeStart>=0?body.slice(scopeStart).trim():"";
 const readingStart=main.search(/\n\n(?:\*\*Observação:\*\*|Sem observações verificadas sobre sua conduta nas reuniões\.)/u);
 return {answer:(readingStart>=0?main.slice(0,readingStart):main).trim(),reading:readingStart>=0?main.slice(readingStart).trim():"",scope};
}
