import { expect, test } from "bun:test";
import { grounded } from "./service";
import type { CoachMeeting } from "./types";
const meeting:CoachMeeting={id:"owned",nome:"QA",original_filename:"qa",recorded_at:null,transcription:"Eu vou concluir uma única prioridade.",segments:[{speaker:"A",start:1,end:5,text:"Eu vou concluir uma única prioridade."}],speaker_labels:{A:"QA"},speaker_pessoas:{A:"self"}};
const observation={competency:"focus",observation:"Uma prioridade",hypothesis:"Mais foco",alternative:"Pontual",experiment:"Acompanhar",evidence:[{meeting_id:"owned",chunk_index:0,quote:meeting.transcription}]};
test("personal observations require verified self attribution",()=>{
 expect(grounded([observation],[meeting],["self"])).toHaveLength(1);
 expect(grounded([observation],[meeting],[])).toHaveLength(0);
});
test("invalid first observation cannot inherit next observation evidence",()=>{
 const raw=[{...observation,evidence:[{meeting_id:"unowned",chunk_index:0,quote:meeting.transcription}]},observation];
 expect(grounded(raw,[meeting],["self"])).toHaveLength(1);
 // Memory index is applied to raw output before filtering, not to compacted output.
 expect(grounded([raw[0]],[meeting],["self"])).toHaveLength(0);
 expect(grounded([raw[1]],[meeting],["self"])[0].evidence[0].meeting_id).toBe("owned");
});
test("one valid quote does not rescue an observation with a fabricated second reference",()=>{
 expect(grounded([{...observation,evidence:[...observation.evidence,{meeting_id:"owned",chunk_index:0,quote:"Esta fala jamais existiu."}]}],[meeting],["self"])).toEqual([]);
});
