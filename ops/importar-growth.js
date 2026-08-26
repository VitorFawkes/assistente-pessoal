#!/usr/bin/env node
// Traz as tarefas da planilha do Growth pro quadro, sem duplicar.
// Regra combinada com o Vitor: quando a tarefa já existe no quadro, ela recebe
// o prazo, o dono e a situação da planilha; quando não existe, nasce nova.
//
//   node ops/importar-growth.js            → só mostra o que faria (padrão)
//   node ops/importar-growth.js --gravar   → grava de verdade
const { Client } = require("pg");

const QUADRO = "007d9fa9-b908-455f-b3b3-156aaf1c0dd8";
const USER = "7740e829-9462-416b-81a1-b787e23ba9b2";
const GRAVAR = process.argv.includes("--gravar");

// "Vitão" na planilha é o Vitor; os outros nomes batem com as pessoas do sistema.
const DONO = { "Robson": "Robson", "Giordana": "Giordana", "Vitão": "Vitor", "Tiago": "Tiago", "Fernanda": "Fernanda" };
const SITUACAO = { "Pendente": "aberta", "Em progresso": "em_andamento", "Aprovação": "aguardando_aprovacao", "Finalizado": "concluida" };

const PLANILHA = [
  { titulo:"Finalizar Revenue Plan V1", prazo:"2026-08-14", donos:["Robson"], situacao:"Aprovação", tema:"Plano & Metas",
    como:"Consolidar histórico, taxas atuais, metas de Lead a WON, custo por lead e planejado x realizado.",
    porque:"Transformar a meta de 7 fechamentos por mês em metas intermediárias e budget necessário.",
    pronto:"V1 preenchida, revisável por Vitor e Tiago, com meta de 7 fechamentos por mês.", depende:"Dados históricos do TARS" },
  { titulo:"Validar distribuição final do budget de R$ 20 mil por mês", prazo:"2026-08-14", donos:["Robson","Tiago"], situacao:"Finalizado", tema:"Plano & Metas",
    como:"Confirmar a divisão: Google R$ 10 mil, Meta R$ 8 mil, novos canais R$ 2 mil.",
    porque:"Garantir que a execução reflita a estratégia aprovada e evitar conflito de versão.",
    pronto:"Budget mensal aprovado e registrado por canal.", depende:"Validação de liderança" },
  { titulo:"Conferir remoção de endereços e parâmetros errados nas palavras-chave", prazo:"2026-08-15", donos:["Robson"], situacao:"Finalizado", tema:"Google Ads",
    como:"Revisar a conta depois da limpeza feita pela Giordana.",
    porque:"Eliminar parametrização errada e evitar leitura incorreta do rastreamento.",
    pronto:"Só o endereço correto do anúncio permanece.", depende:"Limpeza executada pela Giordana" },
  { titulo:"Formalizar as regras do funil, de Lead a fechamento", prazo:"2026-08-17", donos:["Robson","Vitão"], situacao:"Finalizado", tema:"Plano & Metas",
    como:"Documentar descrição, regra de entrada, cálculo, captura e dono de cada etapa.",
    porque:"Garantir que marketing, pré-vendas, vendas e mídia otimizem pelas mesmas definições.",
    pronto:"Regras documentadas e implementáveis, sem ambiguidade entre as etapas.", depende:"Validação de Vitor e Tiago" },
  { titulo:"Validar feedback de conversão qualificada do TARS para Google e Meta", prazo:"2026-08-18", donos:["Vitão","Robson"], situacao:"Em progresso", tema:"Medição & Dados",
    como:"Confirmar envio de eventos profundos, validar o casamento dos dados e o uso nas campanhas.",
    porque:"Fazer os algoritmos otimizarem para qualidade, não apenas para lead.",
    pronto:"Eventos aparecem corretamente nas plataformas e servem de sinal de otimização.", depende:"Definições oficiais do funil" },
  { titulo:"Montar nova estrutura de Google Ads", prazo:"2026-08-20", donos:["Giordana"], situacao:"Em progresso", tema:"Google Ads",
    como:"Estruturar campanha, grupo de anúncio, palavra-chave, anúncio, página e budget.",
    porque:"Reduzir desperdício, melhorar intenção e baixar o custo por lead sem destruir qualidade.",
    pronto:"Estrutura completa enviada para aprovação e pronta para implementação.", depende:"Modelo de plano de mídia" },
  { titulo:"Analisar termos de busca, palavras-chave e negativas", prazo:"2026-08-20", donos:["Giordana"], situacao:"Em progresso", tema:"Google Ads",
    como:"Revisar o brutão de termos, agrupar temas, listar negativas e destacar o que converteu.",
    porque:"Encontrar desperdícios, oportunidades de cauda longa e novos agrupamentos de intenção.",
    pronto:"Lista de grupos, negativas e oportunidades anexada ao plano de Google.", depende:"Acesso à conta Google Ads" },
  { titulo:"Separar campanha de Brand", prazo:"2026-08-20", donos:["Giordana"], situacao:"Em progresso", tema:"Google Ads",
    como:"Isolar os termos Welcome em campanha própria, com orçamento e anúncios dedicados.",
    porque:"Proteger a busca pela marca, evitar limitação de orçamento e medir a marca separada.",
    pronto:"Campanha de marca ativa e isolada dos termos genéricos.", depende:"Nova arquitetura de Google" },
  { titulo:"Reduzir correspondência ampla e reorganizar as correspondências", prazo:"2026-08-20", donos:["Giordana"], situacao:"Pendente", tema:"Google Ads",
    como:"Migrar termos prioritários para frase ou exata quando fizer sentido e reforçar negativas.",
    porque:"Evitar buscas muito abertas e elevar relevância e índice de qualidade.",
    pronto:"Principais grupos sem dependência excessiva de ampla e com negativas aplicadas.", depende:"Análise de termos de busca" },
  { titulo:"Criar plano de Meta Ads", prazo:"2026-08-20", donos:["Giordana"], situacao:"Em progresso", tema:"Meta Ads",
    como:"Definir prospecção, criativos, objetivo de conversão, públicos, orçamento e projeção.",
    porque:"Reativar um canal historicamente subexplorado e diversificar a aquisição.",
    pronto:"Plano Meta V1 entregue e pronto para aprovação e ativação.", depende:"Criativos e rastreamento" },
  { titulo:"Reduzir peso de PMax e redefinir seu papel", prazo:"2026-08-20", donos:["Giordana","Robson"], situacao:"Pendente", tema:"Google Ads",
    como:"Reduzir o budget de PMax e manter uso controlado, de preferência para remarketing.",
    porque:"Abrir espaço para busca estruturada e diminuir exposição a inventário de baixa intenção.",
    pronto:"PMax deixa de dominar o orçamento e passa a ter papel definido no plano.", depende:"Feedback de conversão do TARS para o Google" },
  { titulo:"Estruturar remarketing por grupos de estágio do funil", prazo:"2026-08-21", donos:["Giordana","Vitão","Fernanda"], situacao:"Pendente", tema:"Remarketing",
    como:"Criar públicos: visitante, lead sem qualificação, sem reunião, não compareceu, não fechou e convidados.",
    porque:"Aumentar conversão com comunicação certa para cada estágio do funil.",
    pronto:"Públicos ativos, atualizados e com mensagem específica por estágio.", depende:"Integração do TARS com as plataformas" },
  { titulo:"Criar conta e preparar TikTok Ads", prazo:"2026-08-21", donos:["Giordana"], situacao:"Pendente", tema:"TikTok",
    como:"Criar a conta, configurar a empresa e adicionar o e-mail da Welcome como administrador.",
    porque:"Abrir novo canal de teste com investimento baixo e potencial de descoberta.",
    pronto:"Conta criada, administradores corretos e pronta para campanha.", depende:"Dados de pagamento e perfil da empresa" },
  { titulo:"Gerar o pixel do TikTok", prazo:"2026-08-21", donos:["Giordana"], situacao:"Pendente", tema:"TikTok",
    como:"Criar o pixel e o evento base e enviar as instruções para implementação.",
    porque:"Permitir medição e remarketing no TikTok.",
    pronto:"Pixel gerado e entregue para instalação.", depende:"Conta do TikTok criada" },
  { titulo:"Mapear as páginas necessárias por agrupamento de busca", prazo:"2026-08-21", donos:["Giordana","Robson"], situacao:"Pendente", tema:"Site",
    como:"A partir dos grupos de busca, listar página existente, página inadequada e página nova necessária.",
    porque:"Aumentar aderência entre palavra-chave, anúncio e página, e melhorar a conversão.",
    pronto:"Mapa de páginas com prioridade, tema e campanha associada.", depende:"Nova estrutura de Google" },
  { titulo:"Preparar anúncios e textos para aprovação", prazo:"2026-08-21", donos:["Giordana"], situacao:"Pendente", tema:"Google Ads",
    como:"Adicionar uma aba ao plano com os textos por campanha e grupo, prontos para revisão.",
    porque:"Acelerar a ativação depois da aprovação da nova arquitetura.",
    pronto:"Textos organizados por campanha e aprováveis pelo time.", depende:"Estrutura de Google e Meta definida" },
  { titulo:"Testar formulário do Meta contra WhatsApp com IA", prazo:"2026-08-24", donos:["Giordana","Vitão"], situacao:"Pendente", tema:"Meta Ads",
    como:"Rodar teste controlado entre formulário instantâneo e clique para WhatsApp com triagem por IA.",
    porque:"Entender qual rota gera melhor qualidade e velocidade sem sobrecarregar o comercial.",
    pronto:"Teste com hipótese, janela, indicador e leitura de qualidade por etapa.", depende:"IA estável, rastreamento e feedback de qualidade" },
  { titulo:"Implementar o pixel do TikTok no site", prazo:"2026-08-24", donos:["Robson"], situacao:"Pendente", tema:"TikTok",
    como:"Receber o pixel da Giordana, publicar no site e validar o disparo dos eventos.",
    porque:"Garantir a medição do canal e habilitar públicos de remarketing.",
    pronto:"Pixel disparando e validado em produção.", depende:"Pixel do TikTok gerado" },
  { titulo:"Definir teste inicial de anúncios no ChatGPT", prazo:"2026-08-24", donos:["Robson","Giordana"], situacao:"Pendente", tema:"Novos canais",
    como:"Definir hipótese, temas de alta intenção, budget e indicador de teste, sem plano complexo demais.",
    porque:"Explorar inventário novo e contextual com verba controlada.",
    pronto:"Teste documentado e pronto para ativação.", depende:"Disponibilidade de conta e regras do canal" },
  { titulo:"Criar painel de Planejado x Realizado", prazo:"2026-08-28", donos:["Vitão","Robson"], situacao:"Pendente", tema:"Medição & Dados",
    como:"Transformar o Revenue Plan em painel com visão por período e canal, do lead ao fechamento, com meta, realizado e desvio.",
    porque:"Acompanhar toda semana o realizado contra o planejado e agir rápido nos desvios.",
    pronto:"Painel disponível com planejado x realizado, filtros por período e canal e os desvios claros.", depende:"Revenue Plan V1 aprovado" },
  { titulo:"Criar painel de eficiência por etapa do funil", prazo:"2026-09-04", donos:["Vitão","Robson"], situacao:"Pendente", tema:"Medição & Dados",
    como:"Cruzar investimento de mídia com as etapas do funil e calcular o custo de cada avanço, com cortes por canal, campanha e período.",
    porque:"Sair da gestão só por custo por lead e enxergar quanto custa cada avanço que importa.",
    pronto:"Painel com custo por etapa, filtros por período, canal e campanha, e comparação entre origens.", depende:"Regras oficiais do funil, rastreamento e investimento por canal" },
];

// ─── comparação de títulos: acha a mesma tarefa escrita de outro jeito ───
const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const VAZIAS = new Set(["de","da","do","das","dos","e","o","a","os","as","para","pra","por","com","em","no","na","nos","nas","um","uma","ao","à","que"]);
const palavras = (s) => semAcento(s).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((p) => p.length > 2 && !VAZIAS.has(p));

function parecenca(a, b) {
  const A = new Set(palavras(a)), B = new Set(palavras(b));
  if (!A.size || !B.size) return 0;
  let iguais = 0;
  for (const p of A) if (B.has(p)) iguais++;
  return (2 * iguais) / (A.size + B.size);
}

const descricaoDe = (t) =>
  [`Por quê: ${t.porque}`, `Como: ${t.como}`, `Pronto quando: ${t.pronto}`].join("\n");

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query("SET search_path TO public");
  // O app conecta com o papel que respeita a separação por dono (RLS). Sem
  // dizer de quem é a vez, o banco devolve zero linha — foi o que aconteceu na
  // primeira conferência e teria criado 21 tarefas repetidas.
  await c.query("SELECT set_config('app.current_user_id', $1, false)", [USER]);

  const noQuadro = (await c.query(
    `SELECT t.id, t.titulo, t.status, t.prazo, t.descricao, t.depende_de, t.frente_id
       FROM tarefas t JOIN quadro_tarefas qt ON qt.tarefa_id = t.id
      WHERE qt.quadro_id = $1`, [QUADRO])).rows;

  const pessoas = new Map((await c.query(
    `SELECT id, nome FROM pessoas WHERE user_id = $1`, [USER])).rows.map((p) => [p.nome, p.id]));

  const juntar = [], nascer = [];
  for (const linha of PLANILHA) {
    let melhor = null, nota = 0;
    for (const t of noQuadro) {
      const n = parecenca(linha.titulo, t.titulo);
      if (n > nota) { nota = n; melhor = t; }
    }
    if (nota >= 0.5) juntar.push({ linha, tarefa: melhor, nota });
    else nascer.push({ linha, nota, maisParecida: melhor?.titulo });
  }

  console.log(`\nPlanilha: ${PLANILHA.length} tarefas · Quadro hoje: ${noQuadro.length}\n`);
  console.log(`JUNTAR com tarefa que já existe (${juntar.length}):`);
  juntar.forEach(({ linha, tarefa, nota }) =>
    console.log(`  · "${linha.titulo}"\n      ↳ vira a mesma que "${tarefa.titulo}" (${Math.round(nota * 100)}% parecido)`));
  console.log(`\nNASCER como tarefa nova (${nascer.length}):`);
  nascer.forEach(({ linha, nota, maisParecida }) =>
    console.log(`  · "${linha.titulo}"${maisParecida ? `  (mais parecida no quadro: "${maisParecida}", ${Math.round(nota * 100)}%)` : ""}`));

  if (!GRAVAR) {
    console.log(`\n(nada foi gravado — rode com --gravar depois de conferir)\n`);
    await c.end();
    return;
  }

  async function temaId(nome) {
    if (!nome) return null;
    const slug = semAcento(nome).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "tema";
    const r = await c.query(
      `INSERT INTO frentes (user_id, nome, slug) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, slug) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`,
      [USER, nome, slug]);
    return r.rows[0].id;
  }

  async function pessoaId(nome) {
    const real = DONO[nome] ?? nome;
    if (pessoas.has(real)) return pessoas.get(real);
    const r = await c.query(
      `INSERT INTO pessoas (user_id, nome) VALUES ($1,$2)
       ON CONFLICT (user_id, nome) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`, [USER, real]);
    pessoas.set(real, r.rows[0].id);
    return r.rows[0].id;
  }

  async function poePessoas(tarefaId, donos) {
    await c.query(`DELETE FROM tarefa_pessoas WHERE tarefa_id = $1`, [tarefaId]);
    for (let i = 0; i < donos.length; i++) {
      const pid = await pessoaId(donos[i]);
      await c.query(
        `INSERT INTO tarefa_pessoas (tarefa_id, pessoa_id, principal) VALUES ($1,$2,$3)
         ON CONFLICT (tarefa_id, pessoa_id) DO UPDATE SET principal = EXCLUDED.principal`,
        [tarefaId, pid, i === 0]);
    }
  }

  await c.query("BEGIN");
  try {
    for (const { linha, tarefa } of juntar) {
      await c.query(
        `UPDATE tarefas SET prazo = $1, status = $2, depende_de = COALESCE(depende_de, $3),
                            frente_id = COALESCE(frente_id, $4),
                            descricao = COALESCE(NULLIF(descricao,''), $5), updated_at = now()
          WHERE id = $6`,
        [linha.prazo, SITUACAO[linha.situacao], linha.depende, await temaId(linha.tema), descricaoDe(linha), tarefa.id]);
      await poePessoas(tarefa.id, linha.donos);
    }
    for (const { linha } of nascer) {
      const donoNome = DONO[linha.donos[0]] ?? "vitor";
      const r = await c.query(
        `INSERT INTO tarefas (user_id, titulo, descricao, owner, acao, prazo, status, frente_id, depende_de)
         VALUES ($1,$2,$3,$4,'executar',$5,$6,$7,$8) RETURNING id`,
        [USER, linha.titulo, descricaoDe(linha), donoNome, linha.prazo,
         SITUACAO[linha.situacao], await temaId(linha.tema), linha.depende]);
      const id = r.rows[0].id;
      await poePessoas(id, linha.donos);
      await c.query(
        `INSERT INTO quadro_tarefas (quadro_id, tarefa_id, ordem) VALUES ($1,$2,NULL)
         ON CONFLICT DO NOTHING`, [QUADRO, id]);
    }
    await c.query("COMMIT");
    const fim = await c.query(`SELECT count(*)::int n FROM quadro_tarefas WHERE quadro_id = $1`, [QUADRO]);
    console.log(`\nGravado. O quadro agora tem ${fim.rows[0].n} tarefas.\n`);
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("\nDeu erro, nada foi gravado:", e.message, "\n");
    process.exitCode = 1;
  }
  await c.end();
})();
