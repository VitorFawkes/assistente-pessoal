/**
 * Real CoachDashboard with a synthetic, in-memory API.
 * Does not validate database persistence, auth or provider behavior.
 * Run from frontend after installing a Playwright browser:
 * COACH_PLAYWRIGHT_MODULE=/path/to/playwright node scripts/coach-offline-browser-qa.cjs
 * PLAYWRIGHT_BROWSERS_PATH selects the installed browser cache (including Linux CI).
 * COACH_BROWSER_EXECUTABLE optionally selects an existing Chromium executable.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const { chromium } = require(process.env.COACH_PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const frontend = path.resolve(__dirname, "..");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "coach-offline-qa-"));
  const bundle = path.join(out, "fixture.js");
  execFileSync("bun", ["--no-env-file", "build", "scripts/coach-offline-browser-fixture.tsx",
    "--target", "browser", "--format", "iife", "--minify", "--production", "--outfile", bundle],
    { cwd: frontend, stdio: "pipe" });
  const stylesheet = path.join(frontend, "app/globals.css");
  const css = (await postcss([tailwind({ base: frontend })])
    .process(fs.readFileSync(stylesheet, "utf8"), { from: stylesheet })).css;
  const browser = await chromium.launch({ headless: true, ...(process.env.COACH_BROWSER_EXECUTABLE ? { executablePath: process.env.COACH_BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], checks = [], externalRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  // An intercepted localhost origin provides crypto.randomUUID for real dashboard mutations.
  // No HTTP server is started and every other browser request is rejected.
  const fixtureUrl = "http://127.0.0.1/coach-offline-qa";
  const fixtureHtml = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '\nbody{margin:0;background:var(--background);color:var(--foreground);font-family:Arial,sans-serif}main{max-width:800px;margin:auto;padding:32px 20px}</style></head><body><main id="root"></main></body></html>';
  await page.route("**/*", route => {
    if (route.request().url() === fixtureUrl) return route.fulfill({ status: 200, contentType: "text/html", body: fixtureHtml });
    externalRequests.push(route.request().url());
    return route.abort();
  });
  const check = (condition, name) => { assert.ok(condition, name); checks.push(name); };
  try {
    await page.goto(fixtureUrl);
    await page.addScriptTag({ content: fs.readFileSync(bundle, "utf8") });
    await page.getByRole("button", { name: "Ajustes", exact: true }).click();
    const goals = page.getByRole("textbox", { name: "Meus objetivos" });
    const context = page.getByRole("textbox", { name: "Meu contexto e minhas dificuldades" });
    await goals.fill("Rascunho de objetivo que precisa permanecer");
    await context.fill("Contexto ainda não salvo");
    await page.getByRole("checkbox", { name: "Usar minha agenda" }).click();
    await page.getByText("Leitura da agenda pausada; a cópia local foi removida.").waitFor();
    check(await goals.inputValue() === "Rascunho de objetivo que precisa permanecer", "goal draft survives calendar revision");
    check(await context.inputValue() === "Contexto ainda não salvo", "context draft survives calendar revision");
    await page.getByRole("button", { name: "Salvar configurações", exact: true }).click();
    await page.getByText("Configurações salvas.").waitFor();
    check(await page.evaluate(() => window.__fixture.state().profile.goals) === "Rascunho de objetivo que precisa permanecer", "save sends preserved draft to synthetic API");
    await page.evaluate(() => window.__fixture.remount());
    await page.getByRole("button", { name: "Ajustes", exact: true }).click();
    check(await goals.inputValue() === "Rascunho de objetivo que precisa permanecer", "remount reads saved synthetic settings");
    check(!await page.getByRole("checkbox", { name: "Usar minha agenda" }).isChecked(), "remount retains synthetic calendar preference");
    await page.screenshot({ path: path.join(out, "desktop-settings.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile settings have no horizontal overflow");
    await page.screenshot({ path: path.join(out, "mobile-settings.png"), fullPage: true });
    await page.getByRole("button", { name: "Ajustes", exact: true }).click();
    const now = new Date().toISOString();
    const memory = { id: "memory", user_id: "synthetic-offline", kind: "context", content: "Tenho dificuldade para escolher uma prioridade", status: "confirmed", lifecycle: "active", evidence: [], history: [], created_at: now, updated_at: now };
    const message = { id: "message", role: "user", content: "Quero retomar o combinado de caminhar amanhã", evidence: [], created_at: now };
    const commitment = { id: "commitment", user_id: "synthetic-offline", title: "Caminhar amanhã", status: "open", history: [], created_at: now, updated_at: now };
    const reviewCases = [
      { name: "reports alone enable weekly review", coverage: { total_meetings: 2, report_ready_meetings: 2 }, enabled: true },
      { name: "analyzed transcript alone enables weekly review", coverage: { total_meetings: 1, analyzed_chunks: 1 }, enabled: true },
      { name: "goal alone enables review without meetings", profile: { goals: "Reservar tempo para minha saúde" }, enabled: true },
      { name: "context alone enables review without meetings", profile: { context: "Estou sobrecarregado e preciso escolher" }, enabled: true },
      { name: "memory alone enables review without meetings", memories: [memory], enabled: true },
      { name: "commitment alone enables review without meetings", commitments: [commitment], enabled: true },
      { name: "conversation alone enables review without meetings", messages: [message], enabled: true },
      { name: "current assistant context enables review without meetings", messages: [{ ...message, role: "assistant", context_freshness: "current" }], enabled: true },
      { name: "empty context cannot prepare review", enabled: false },
      { name: "whitespace context cannot prepare review", profile: { goals: " \n ", context: "\t" }, enabled: false },
      { name: "stale or rejected memories cannot enable review", memories: [{ ...memory, stale: true }, { ...memory, id: "rejected", status: "rejected" }], enabled: false },
      { name: "unknown assistant lineage cannot enable review", messages: [{ ...message, role: "assistant", context_freshness: "unknown" }], enabled: false },
      { name: "stale conversation cannot enable review", messages: [{ ...message, stale: true }], enabled: false },
      { name: "paused coach cannot prepare review", profile: { enabled: false, goals: "Minha prioridade" }, enabled: false },
      { name: "unavailable model cannot prepare review", profile: { goals: "Minha prioridade" }, model_available: false, enabled: false },
    ];
    for (const scenario of reviewCases) {
      await page.evaluate(scenario => {
        const f = window.__fixture, state = f.state();
        Object.assign(state.profile, { goals: "", context: "", enabled: true }, scenario.profile);
        state.memories = scenario.memories || [];
        state.messages = scenario.messages || [];
        state.commitments = scenario.commitments || [];
        state.model_available = scenario.model_available !== false;
        f.setCoverage({ total_meetings: 0, report_ready_meetings: 0, analyzed_chunks: 0, analyzed_meetings: 0, pending_meetings: 0, ...scenario.coverage });
        f.remount();
      }, scenario);
      await page.getByRole("tab", { name: "Sua semana", exact: true }).click();
      const prepareReview = page.getByRole("button", { name: "Preparar revisão", exact: true });
      check(await prepareReview.isEnabled() === scenario.enabled, scenario.name);
      if (scenario.profile?.goals === "Reservar tempo para minha saúde") {
        await prepareReview.click();
        await page.waitForFunction(() => window.__fixture.calls.some(call => call.action === "review"));
        check(await page.evaluate(() => window.__fixture.calls.some(call => call.action === "review" && typeof call.request_id === "string")), "goal-only review sends a synthetic request with an idempotency key");
        await page.screenshot({ path: path.join(out, "mobile-personal-review.png"), fullPage: true });
      }
    }
    check(externalRequests.length === 0, "synthetic browser scenario makes no external requests");
    check(errors.length === 0, "no browser runtime errors");
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ synthetic: true, ok: true, checks, errors }, null, 2));
    console.log(JSON.stringify({ ok: true, checks: checks.length, artifacts: out }));
  } catch (error) {
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ synthetic: true, ok: false, checks, errors, failure: error.message }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
