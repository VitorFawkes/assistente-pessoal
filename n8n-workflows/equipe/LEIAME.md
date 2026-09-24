# Fluxos n8n da instância da equipe (Ações para toda a Welcome)

Cópia dos 4 fluxos que rodam no n8n do servidor da equipe (não no n8n do Vitor).
A chave de entrada dos webhooks foi trocada por `{{EQ_WEBHOOK_TOKEN}}`; o valor
real fica fora do repositório. Credenciais (OpenAI, Postgres) são referenciadas
por id e vivem só no n8n do servidor.

Diferenças em relação aos fluxos do Vitor:
- dono da conta = "eu" (não "vitor"); o nome da pessoa vem de `users.nome`
  junto com a leitura de pessoas/reunião (`dono_nome`), filtrado por `user_id`;
- o normalizador de dono troca o nome/primeiro nome do dono por "eu".

Para aplicar: `n8n import:workflow` + `n8n publish:workflow` dentro do
container n8n do servidor da equipe, depois reiniciar o n8n.
