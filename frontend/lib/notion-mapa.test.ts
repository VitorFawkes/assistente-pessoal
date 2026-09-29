import { describe, expect, test } from "bun:test";
import {
  buDoWorkspace,
  chaveDoArquivo,
  decidir,
  etapaEmPortugues,
  idDaBase,
  lerPagina,
  lerProjeto,
  nomeLimpo,
  propriedadesPara,
  statusDoNotion,
  statusParaNotion,
  type Campos,
  type PaginaNotion,
} from "./notion-mapa";

// Uma página como a base Tasks do marketing devolve (formato da API, 25/09/2026).
const pagina = (extra: Partial<PaginaNotion> = {}, props: Record<string, unknown> = {}): PaginaNotion => ({
  id: "pg-1",
  url: "https://www.notion.so/pg1",
  last_edited_time: "2026-09-25T18:00:00.000Z",
  last_edited_by: { id: "u-paula" },
  properties: {
    Name: { type: "title", title: [{ plain_text: "Definição do ICP Ideal" }] },
    Status: { type: "status", status: { name: "Up next" } },
    "Due date": { type: "date", date: { start: "2026-09-30", end: null } },
    Person: { type: "people", people: [{ id: "u-paula", name: "Paula Klotz | Welcome Trips", person: { email: "Paula@WelcomeTrips.com.br" } }] },
    Assign: { type: "people", people: [{ id: "u-angela", name: "Angela | Welcome Trips" }] },
    BU: { type: "select", select: { name: "Weddings" } },
    Description: { type: "rich_text", rich_text: [{ plain_text: "Desenvolver junto ao comercial" }] },
    Priority: { type: "select", select: { name: "High" } },
    ...props,
  },
  ...extra,
});

describe("lendo uma página do Notion", () => {
  test("campos principais", () => {
    const p = lerPagina(pagina());
    expect(p.titulo).toBe("Definição do ICP Ideal");
    expect(p.status).toBe("aberta");
    expect(p.statusNotion).toBe("Up next");
    expect(p.prazo).toBe("2026-09-30");
    expect(p.pessoa).toBe("u-paula");
    expect(p.pessoas.map((x) => x.nome)).toEqual(["Paula Klotz", "Angela"]);
    expect(p.pessoas[0].email).toBe("paula@welcometrips.com.br");
    expect(p.bu).toBe("Weddings");
    expect(p.prioridade).toBe("alta");
    expect(p.noLixo).toBe(false);
  });

  test("intervalo de datas vale o fim; sem Person usa Assign", () => {
    const p = lerPagina(
      pagina({}, { "Due date": { date: { start: "2026-10-15", end: "2026-10-31" } }, Person: { people: [] } }),
    );
    expect(p.prazo).toBe("2026-10-31");
    expect(p.pessoa).toBe("u-angela");
  });

  test("na lixeira", () => {
    expect(lerPagina(pagina({ in_trash: true })).noLixo).toBe(true);
  });

  test("quem usa a coluna Text: vira a descrição e grava de volta no Text", () => {
    const p = lerPagina(pagina({}, { Description: { rich_text: [] }, Text: { rich_text: [{ plain_text: "@Paula Klotz | Welcome Trips tarefa travada" }] } }));
    expect(p.descricao).toBe("@Paula Klotz | Welcome Trips tarefa travada");
    expect(p.campoDescricao).toBe("Text");
    expect(propriedadesPara({ descricao: "nova" }, { campoDescricao: "Text" })).toEqual({ Text: { rich_text: [{ text: { content: "nova" } }] } });
    expect(lerPagina(pagina()).campoDescricao).toBe("Description");
  });

  test("projeto, quem criou e arquivos", () => {
    const p = lerPagina(
      pagina(
        { created_by: { id: "u-fabi" } },
        {
          Project: { type: "relation", relation: [{ id: "proj-rotinas" }] },
          "Files & media": {
            type: "files",
            files: [
              { name: "Pasta", type: "external", external: { url: "https://smart2bk.sharepoint.com/x" } },
              { name: "briefing.pdf", type: "file", file: { url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/a/b/briefing.pdf?X-Amz-Signature=1" } },
            ],
          },
        },
      ),
    );
    expect(p.projeto).toBe("proj-rotinas");
    expect(p.criadoPor).toBe("u-fabi");
    expect(p.arquivos.map((f) => f.chave)).toEqual([
      "https://smart2bk.sharepoint.com/x",
      "prod-files-secure.s3.us-west-2.amazonaws.com/a/b/briefing.pdf",
    ]);
    expect(lerPagina(pagina()).projeto).toBe("");
  });

  test("a chave do arquivo guardado no Notion não muda com a assinatura", () => {
    const a = chaveDoArquivo("file", "https://s3.aws.com/x/y/z.pdf?X-Amz-Signature=1");
    const b = chaveDoArquivo("file", "https://s3.aws.com/x/y/z.pdf?X-Amz-Signature=2");
    expect(a).toBe(b);
    expect(chaveDoArquivo("external", "https://a.com/?q=1")).toBe("https://a.com/?q=1");
  });
});

describe("projetos do Notion", () => {
  test("lê nome, etapa, período e líder", () => {
    const p = lerProjeto({
      id: "proj-1",
      url: "https://www.notion.so/proj1",
      last_edited_time: "2026-09-29T12:00:00.000Z",
      properties: {
        Name: { type: "title", title: [{ plain_text: "Rotinas" }] },
        Stage: { type: "select", select: { name: "In Progress" } },
        Timeline: { type: "date", date: { start: "2026-09-18", end: "2026-12-31" } },
        Lead: { type: "people", people: [{ id: "u-paula" }] },
      },
    });
    expect(p).toMatchObject({ nome: "Rotinas", etapa: "In Progress", inicio: "2026-09-18", fim: "2026-12-31", lider: "u-paula", noLixo: false });
    expect(etapaEmPortugues(p.etapa)).toBe("Em andamento");
    expect(etapaEmPortugues("Idea")).toBe("Ideia");
  });
  test("gravar o projeto da tarefa", () => {
    expect(propriedadesPara({ projeto: "proj-1" })).toEqual({ Project: { relation: [{ id: "proj-1" }] } });
    expect(propriedadesPara({ projeto: "" })).toEqual({ Project: { relation: [] } });
  });
  test("trocar de projeto num lado vai pro outro", () => {
    const base: Campos = { titulo: "A", descricao: "", prazo: "", status: "aberta", prioridade: "media", pessoa: "", projeto: "proj-1" };
    expect(decidir({ ...base, projeto: "proj-2" }, base, base, { notion: "2026-09-29T12:00:00Z", acoes: "2026-09-29T11:00:00Z" }).paraAcoes).toEqual({ projeto: "proj-2" });
    expect(decidir(base, { ...base, projeto: "" }, base, { notion: "2026-09-29T12:00:00Z", acoes: "2026-09-29T13:00:00Z" }).paraNotion).toEqual({ projeto: "" });
    // Ligação antiga (sem projeto guardado): o Notion vale.
    const { projeto: _p, ...velho } = base;
    expect(decidir({ ...base, projeto: "proj-9" }, { ...base, projeto: "" }, velho, { notion: "2026-09-29T12:00:00Z", acoes: "2026-09-29T13:00:00Z" }).paraAcoes).toEqual({ projeto: "proj-9" });
  });
});

describe("situação", () => {
  test("Notion → Ações", () => {
    expect(statusDoNotion("Not started")).toBe("aberta");
    expect(statusDoNotion("Up next")).toBe("aberta");
    expect(statusDoNotion("This Week")).toBe("em_andamento");
    expect(statusDoNotion("In Approval")).toBe("aguardando_aprovacao");
    expect(statusDoNotion("Done")).toBe("concluida");
    expect(statusDoNotion("coisa nova")).toBe("aberta");
  });
  test("as 8 situações da base (29/09): To Day e Daily são fazendo; Locked fica aberta", () => {
    expect(statusDoNotion("To Day")).toBe("em_andamento");
    expect(statusDoNotion("Daily")).toBe("em_andamento");
    expect(statusDoNotion("Locked")).toBe("aberta");
  });
  test("Ações → Notion: o nome de lá fica quando quer dizer a mesma coisa", () => {
    expect(statusParaNotion("em_andamento", "To Day")).toBe("To Day");
    expect(statusParaNotion("em_andamento", "Daily")).toBe("Daily");
    expect(statusParaNotion("aberta", "Locked")).toBe("Locked");
    expect(statusParaNotion("em_andamento", "Locked")).toBe("This Week");
    expect(statusParaNotion("concluida", "To Day")).toBe("Done");
  });
  test("Ações → Notion: aberta mantém Up next; cancelada não tem situação (vai pra lixeira)", () => {
    expect(statusParaNotion("aberta", "Up next")).toBe("Up next");
    expect(statusParaNotion("aberta", "Done")).toBe("Not started");
    expect(statusParaNotion("em_andamento", null)).toBe("This Week");
    expect(statusParaNotion("aguardando_aprovacao", null)).toBe("In Approval");
    expect(statusParaNotion("concluida", null)).toBe("Done");
    expect(statusParaNotion("cancelada", null)).toBeNull();
  });
});

describe("gravando no Notion", () => {
  test("monta as propriedades pedidas, com área e prioridade", () => {
    const p = propriedadesPara(
      { titulo: "Revisar orçamento", prazo: "2026-10-02", status: "aberta", prioridade: "urgente", pessoa: "u-paula", descricao: "" },
      { bu: "Trips" },
    );
    expect(p).toEqual({
      Name: { title: [{ text: { content: "Revisar orçamento" } }] },
      Description: { rich_text: [] },
      "Due date": { date: { start: "2026-10-02" } },
      Status: { status: { name: "Not started" } },
      Priority: { select: { name: "Urgent" } },
      Person: { people: [{ id: "u-paula" }] },
      BU: { select: { name: "Trips" } },
    });
  });
  test("sem prazo apaga a data; prioridade baixa fica vazia", () => {
    const p = propriedadesPara({ prazo: "", prioridade: "baixa" });
    expect(p["Due date"]).toEqual({ date: null });
    expect(p.Priority).toEqual({ select: null });
  });
});

describe("quem vence", () => {
  const base: Campos = { titulo: "A", descricao: "", prazo: "2026-09-30", status: "aberta", prioridade: "media", pessoa: "u-paula", projeto: "" };

  test("mudou só no Notion → vai pra ação", () => {
    const d = decidir({ ...base, status: "em_andamento" }, base, base, { notion: "2026-09-25T18:00:00Z", acoes: "2026-09-25T17:00:00Z" });
    expect(d.paraAcoes).toEqual({ status: "em_andamento" });
    expect(d.paraNotion).toEqual({});
  });

  test("mudou só na ação → vai pro Notion", () => {
    const d = decidir(base, { ...base, prazo: "2026-10-05" }, base, { notion: "2026-09-25T18:00:00Z", acoes: "2026-09-25T19:00:00Z" });
    expect(d.paraNotion).toEqual({ prazo: "2026-10-05" });
    expect(d.paraAcoes).toEqual({});
  });

  test("mudou dos dois lados: vale o mais recente; empate fica com o Notion", () => {
    const n = { ...base, prazo: "2026-10-01" };
    const a = { ...base, prazo: "2026-10-09" };
    const acoesDepois = decidir(n, a, base, { notion: "2026-09-25T18:00:00Z", acoes: "2026-09-25T18:05:00Z" });
    expect(acoesDepois.paraNotion).toEqual({ prazo: "2026-10-09" });
    expect(acoesDepois.conflitos).toEqual(["prazo"]);
    const empate = decidir(n, a, base, { notion: "2026-09-25T18:05:00Z", acoes: "2026-09-25T18:05:00Z" });
    expect(empate.paraAcoes).toEqual({ prazo: "2026-10-01" });
  });

  test("igual dos dois lados não faz nada (nosso próprio eco)", () => {
    const d = decidir(base, base, { ...base, titulo: "velho" }, { notion: "2026-09-25T18:00:00Z", acoes: "2026-09-25T18:00:00Z" });
    expect(d).toEqual({ paraAcoes: {}, paraNotion: {}, conflitos: [] });
  });

  test("primeira vez (sem histórico) o Notion vale", () => {
    const d = decidir({ ...base, titulo: "Do Notion" }, { ...base, titulo: "Do Ações" }, null, { notion: "2026-09-25T18:00:00Z", acoes: "2026-09-25T19:00:00Z" });
    expect(d.paraAcoes).toEqual({ titulo: "Do Notion" });
  });
});

describe("apoio", () => {
  test("nome sem a empresa", () => {
    expect(nomeLimpo("Paula Klotz | Welcome Trips")).toBe("Paula Klotz");
    expect(nomeLimpo("Fabí")).toBe("Fabí");
  });
  test("área pelo workspace", () => {
    expect(buDoWorkspace("welcome-weddings")).toBe("Weddings");
    expect(buDoWorkspace("welcome-trips")).toBe("Trips");
    expect(buDoWorkspace("welcome-corporativo")).toBe("Corp");
    expect(buDoWorkspace("welcome-group")).toBe("Institucional");
    expect(buDoWorkspace(null)).toBe("Institucional");
  });
  test("id da base a partir do link", () => {
    expect(idDaBase("https://app.notion.com/p/3d6d6db41ae78062b937e865b2e9cf72?v=3d6d6db41ae780f1870c000c07ff45e9")).toBe(
      "3d6d6db4-1ae7-8062-b937-e865b2e9cf72",
    );
    expect(idDaBase("nada")).toBeNull();
  });
});
