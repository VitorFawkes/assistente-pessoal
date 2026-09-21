import {expect,test} from "bun:test";
import {contextTimezone,localContextDates} from "./context-dates";
test("server formats timezone and DST without changing original timestamps, date-only values or prose",()=>{
 const data={current_time:"2026-09-20T18:00:00.000Z",tasks:[{prazo:"2026-09-20T19:00:00.000Z",due_at:"2026-09-21",quote:"Prazo 2026-09-20T18:00:00.000Z"}]};
 expect(localContextDates(data,"America/Sao_Paulo")).toEqual({...data,current_time_local:"20/09/2026, 15:00:00 (America/Sao_Paulo)",tasks:[{...data.tasks[0],prazo_local:"20/09/2026, 16:00:00 (America/Sao_Paulo)"}]});
 expect((localContextDates({recorded_at:"2026-03-08T07:00:00.000Z"},"America/New_York") as Record<string,unknown>).recorded_at_local).toBe("08/03/2026, 03:00:00 (America/New_York)");
 expect(data).not.toHaveProperty("current_time_local");expect(contextTimezone({profile:{timezone:"Pacific/Kiritimati"}})).toBe("Pacific/Kiritimati");
});
