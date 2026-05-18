# Prompt pro Cowork — fix permissões /audios

> O n8n não consegue escrever em /audios porque o volume está com owner root e n8n roda como user `node`. Solução: criar um serviço alpine temporário que monta o mesmo volume e roda chmod 777.

```
=====
Tarefa: dar permissão de escrita pro user "node" (uid 1000) no volume "audios" do projeto n8n no easypanel.

Trabalha autonomamente.

═══ Caminho A — Terminal do easypanel no container n8n (mais rápido) ═══

1) Abre http://46.202.149.176:3000 → projeto n8n → serviço n8n
2) Procura aba **Console** / **Terminal** (algumas versões do easypanel têm um botão "Open Terminal" ou "Shell")
3) Se tiver, conecta como ROOT (não como user padrão) e roda:
   ```
   chmod 777 /audios
   ls -la /audios
   ```
4) Confirma que ficou drwxrwxrwx

Se NÃO tiver Terminal, vai pro Caminho B.

═══ Caminho B — Cria serviço temporário "audios-fix" via UI (5 cliques) ═══

1) http://46.202.149.176:3000 → projeto n8n → botão **+ Service** (canto superior)
2) Tipo: **App**
3) Nome: `audios-fix`
4) Source / Image: `alpine:latest` (imagem Docker pública)
5) Vai em **Mounts** → + Add Mount:
   - Type: **Volume**
   - Name: **audios**  (mesmo volume do n8n)
   - Mount Path: **/audios**
6) Vai em **Deploy** → coloca no campo **Command** o seguinte:
   ```
   sh -c "chmod 777 /audios && ls -la /audios && echo DONE && sleep 60"
   ```
7) Clica em **Deploy**
8) Vai pra aba **Logs** e espera ver `DONE` (~5s)
9) Confirma que apareceu o `ls -la /audios` mostrando `drwxrwxrwx`
10) Depois de confirmar, clica em **Destroy Service** pra remover o `audios-fix` (já não precisa mais)

═══ Validação ═══

Depois disso, vai no serviço n8n → aba **Mounts** → confirme que ainda tem `data` e `audios` listados (não devem ter mudado).

═══ Me reportar ═══

- Caminho usado (A ou B)
- Output literal do `ls -la /audios`
- Se deletou o `audios-fix` no final
=====
```
