import { NextResponse } from "next/server";
import { readdirSync, statSync, writeFileSync, accessSync, constants } from "node:fs";
import { resolve } from "node:path";

const AUDIO_ROOT = process.env.AUDIO_ROOT || "/audios";

type Result = {
  audioRoot: string;
  exists?: boolean;
  isDir?: boolean;
  mode?: string;
  uid?: number;
  gid?: number;
  contents?: string[];
  writable?: boolean;
  accessErr?: string;
  writeOk?: boolean;
  writeErr?: string;
  processUid?: number;
  processGid?: number;
  statErr?: string;
};

export async function GET() {
  const r: Result = { audioRoot: AUDIO_ROOT };
  try {
    const st = statSync(AUDIO_ROOT);
    r.exists = true;
    r.isDir = st.isDirectory();
    r.mode = "0" + (st.mode & 0o777).toString(8);
    r.uid = st.uid;
    r.gid = st.gid;
  } catch (e) {
    r.statErr = e instanceof Error ? e.message : String(e);
  }
  try {
    r.contents = readdirSync(AUDIO_ROOT).slice(0, 50);
  } catch (e) {
    /* ignore */
  }
  try {
    accessSync(AUDIO_ROOT, constants.W_OK);
    r.writable = true;
  } catch (e) {
    r.writable = false;
    r.accessErr = e instanceof Error ? e.message : String(e);
  }
  try {
    const testPath = resolve(AUDIO_ROOT, ".frontend-write-test-" + Date.now() + ".txt");
    writeFileSync(testPath, "ok");
    r.writeOk = true;
  } catch (e) {
    r.writeOk = false;
    r.writeErr = e instanceof Error ? e.message : String(e);
  }
  try {
    r.processUid = process.getuid?.();
    r.processGid = process.getgid?.();
  } catch (e) {
    /* ignore */
  }
  return NextResponse.json(r);
}
