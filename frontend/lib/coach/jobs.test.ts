import { describe, expect, test } from "bun:test";
import { dueCheckins, extraFollowupAllowed, retryDelaySeconds, publicJob, validateJobInput } from "./jobs";

describe("durable coaching work", () => {
  const profile = { enabled: true, morning_enabled: true, evening_enabled: true, nudges_enabled: true, morning_hour: 8, evening_hour: 18, timezone: "America/Sao_Paulo" };
  test("morning/evening use local time and never backfill old daily nudges", () => {
    expect(dueCheckins(profile,new Date("2026-09-21T11:10:00Z"),false)).toEqual(["morning"]);
    expect(dueCheckins(profile,new Date("2026-09-21T21:10:00Z"),false)).toEqual(["evening"]);
    expect(dueCheckins(profile,new Date("2026-09-22T02:00:00Z"),true)).toEqual([]);
    expect(dueCheckins({...profile,enabled:false},new Date("2026-09-21T11:10:00Z"),true)).toEqual([]);
  });
  test("interruption requires concrete trigger and explicit cadence permission", () => {
    const now=new Date("2026-09-21T17:00:00Z");
    expect(dueCheckins(profile,now,false)).toEqual([]);
    expect(dueCheckins(profile,now,true)).toEqual(["nudge"]);
    expect(dueCheckins({...profile,nudges_enabled:false},now,true)).toEqual([]);
  });
  test("jobs validate bounded payloads and preserve retry identity", () => {
    expect(validateJobInput({kind:"chat",key:"request-123",payload:{message:"Me ajude."}})).toEqual({kind:"chat",key:"request-123",payload:{message:"Me ajude."}});
    expect(()=>validateJobInput({kind:"chat",key:"x",payload:{message:" "}})).toThrow();
    expect(()=>validateJobInput({kind:"checkin",key:"x",payload:{checkin:"anything"}})).toThrow();
    expect(retryDelaySeconds(1)).toBe(30);
    expect(retryDelaySeconds(3)).toBe(120);
  });
  test("public progress never leaks prompt or lease credentials", () => {
    const source={id:"id",kind:"chat",status:"running",attempts:1,created_at:new Date("2026-09-20Z"),updated_at:new Date("2026-09-20Z"),error:null,payload:{message:"private"},lease_token:"secret",key:"private-key",profile_revision:1};
    const visible=publicJob(source);
    expect(visible.status).toBe("running");
    expect(JSON.stringify(visible)).not.toMatch(/private|secret|lease_token|payload/);
  });
});

test("a meeting follow-up carries only a valid meeting id", () => {
  const meeting_id = "33333333-3333-4333-8333-333333333333";
  expect(validateJobInput({kind:"checkin",key:"scheduled:meeting:x",payload:{checkin:"meeting",meeting_id,extra:"no"}}).payload).toEqual({checkin:"meeting",meeting_id});
  expect(() => validateJobInput({kind:"checkin",key:"manual:meeting",payload:{checkin:"meeting"}})).toThrow("invalid_input");
  expect(() => validateJobInput({kind:"checkin",key:"manual:meeting",payload:{checkin:"meeting",meeting_id:"1 OR 1=1"}})).toThrow("invalid_input");
  expect(validateJobInput({kind:"checkin",key:"scheduled:morning:x",payload:{checkin:"morning",meeting_id}}).payload).toEqual({checkin:"morning"});
});

test("optional follow-ups respect the attention budget", () => {
  const free = { extraToday: false, lastPublished: null, unanswered: 0 };
  const at = (iso: string) => new Date(iso);
  // 14:00 in São Paulo.
  expect(extraFollowupAllowed(free, at("2026-09-23T17:00:00Z"), "America/Sao_Paulo")).toBe(true);
  expect(extraFollowupAllowed(free, at("2026-09-23T12:59:00Z"), "America/Sao_Paulo")).toBe(false);
  expect(extraFollowupAllowed(free, at("2026-09-23T19:00:00Z"), "America/Sao_Paulo")).toBe(false);
  expect(extraFollowupAllowed({ ...free, extraToday: true }, at("2026-09-23T17:00:00Z"), "America/Sao_Paulo")).toBe(false);
  expect(extraFollowupAllowed({ ...free, unanswered: 2 }, at("2026-09-23T17:00:00Z"), "America/Sao_Paulo")).toBe(false);
  expect(extraFollowupAllowed({ ...free, unanswered: 1 }, at("2026-09-23T17:00:00Z"), "America/Sao_Paulo")).toBe(true);
  expect(extraFollowupAllowed({ ...free, lastPublished: at("2026-09-23T14:30:00Z") }, at("2026-09-23T17:00:00Z"), "America/Sao_Paulo")).toBe(false);
  expect(extraFollowupAllowed({ ...free, lastPublished: at("2026-09-23T14:00:00Z") }, at("2026-09-23T17:00:00Z"), "America/Sao_Paulo")).toBe(true);
});
