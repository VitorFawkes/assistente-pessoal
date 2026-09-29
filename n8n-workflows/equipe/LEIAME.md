# Fluxos n8n da instância da equipe (Ações para toda a Welcome)

Cópia dos 4 fluxos que rodam no n8n do servidor da equipe (não no n8n do Vitor).
A chave de entrada dos webhooks foi trocada por `{{EQ_WEBHOOK_TOKEN}}`; o valor
real fica fora do repositório. Credenciais (OpenAI, Postgres) são referenciadas
por id e vivem só no n8n do servidor.

Diferenças em relação aos fluxos do Vitor:
- dono da conta = "eu" (não "vitor"); o nome da pessoa vem de `users.nome`
  junto com a leitura de pessoas/reunião (`dono_nome`), filtrado por `user_id`;
- o normalizador de dono troca o nome/primeiro nome do dono por "eu".

Desde 29/09/2026 a leitura é a mesma do Ações pessoal (#23, #24 e #29 do repo):
o Stage A chama o sub-fluxo `Equipe - Acoes - Relatorio Luna` (id `EqRelatorioLuna1`,
relatório em etapas com GPT-6 Luna e reserva GPT-6 Sol), Distiller e Judge em
`gpt-6-luna` sem temperature, sem o Think no Distiller. O "Prepara relatório" manda
o `dono_nome` para o sub-fluxo: para o Vitor os textos ficam idênticos aos do Ações
pessoal; para outra pessoa, as frases sobre o dono da lista usam o nome dela.

Para aplicar: `n8n import:workflow` + `n8n publish:workflow` dentro do
container n8n do servidor da equipe (o sub-fluxo antes dos outros 4), depois
reiniciar o n8n (conferir antes que não há reunião sendo lida).
