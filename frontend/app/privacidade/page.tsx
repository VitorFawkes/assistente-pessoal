export const dynamic = "force-dynamic";

export default function PrivacidadePage() {
  return (
    <article className="prose prose-sm max-w-2xl mx-auto py-8 space-y-6">
      <header>
        <h1 className="font-display text-3xl sm:text-4xl leading-tight mb-2">
          Política de Privacidade
        </h1>
        <p className="text-sm text-[color:var(--muted-strong)]">
          Versão 1.0 — Setembro de 2026
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Quem é o controlador de dados</h2>
        <p className="text-sm leading-relaxed">
          A Welcome (Welcome Trips e Welcome Weddings) é a controladora dos dados pessoais processados nesta plataforma.
          Nos comprometemos a proteger sua privacidade de acordo com a Lei Geral de Proteção
          de Dados (LGPD) do Brasil.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Dados que coletamos</h2>
        <div className="space-y-3 text-sm leading-relaxed">
          <p>
            Coletamos e processamos:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li>Gravações de áudio das suas reuniões</li>
            <li>Transcrições de áudio (processadas via AssemblyAI, nos EUA)</li>
            <li>Análises de inteligência artificial sobre o conteúdo das reuniões (via OpenAI, nos EUA)</li>
            <li>Dados de identificação de falantes (reconhecimento de voz)</li>
            <li>Seu nome, e-mail e informações de conta</li>
          </ul>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Como usamos seus dados</h2>
        <p className="text-sm leading-relaxed">
          Seus dados são usados para:
        </p>
        <ul className="list-disc list-inside space-y-2 ml-2 text-sm leading-relaxed">
          <li>Transcrever suas reuniões gravadas</li>
          <li>Gerar resumos e relatórios de reuniões</li>
          <li>Extrair e organizar tarefas a partir das reuniões</li>
          <li>Identificar os falantes e atribuir tarefas corretamente</li>
          <li>Fornecer análises e insights sobre suas reuniões</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Quem pode acessar seus dados</h2>
        <p className="text-sm leading-relaxed">
          Por padrão, só você vê as reuniões que gravar. Você pode liberar cada reunião de
          duas formas:
        </p>
        <ul className="list-disc list-inside space-y-2 ml-2 text-sm leading-relaxed">
          <li><strong>Escolher pessoas e times:</strong> você escolhe quem na Welcome vê a reunião</li>
          <li><strong>Toda a Welcome:</strong> qualquer pessoa da Welcome com acesso ao Ações vê a reunião</li>
        </ul>
        <p className="text-sm leading-relaxed">
          Uma tarefa que você passa para um colega, ou coloca num projeto com outras pessoas,
          fica visível para elas. A reunião de onde a tarefa saiu continua só sua: quem recebe
          não vê a gravação, a transcrição nem o trecho.
        </p>
        <p className="text-sm leading-relaxed">
          Você pode mudar essas permissões a qualquer momento na página de cada reunião.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Processamento nos EUA</h2>
        <p className="text-sm leading-relaxed">
          A transcrição de suas reuniões é processada pelo AssemblyAI e a análise de inteligência
          artificial pelo OpenAI, ambos nos Estados Unidos. Ao usar esta plataforma, você consente
          com a transferência e processamento de seus dados nos EUA, sujeito aos termos de privacidade
          desses serviços.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Direitos do titular dos dados</h2>
        <p className="text-sm leading-relaxed">
          Você tem direito a:
        </p>
        <ul className="list-disc list-inside space-y-2 ml-2 text-sm leading-relaxed">
          <li>Acessar seus dados pessoais</li>
          <li>Corrigir dados imprecisos</li>
          <li>Solicitar a exclusão de seus dados</li>
          <li>Revogar seu consentimento a qualquer momento</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Como solicitar exclusão</h2>
        <p className="text-sm leading-relaxed">
          Você mesmo apaga qualquer reunião sua: abra a reunião e toque em &quot;Apagar&quot;. Some tudo
          dela na hora: a gravação, a transcrição, o resumo, as tarefas e as vozes aprendidas nela.
          Tarefas também se apagam uma a uma. Para apagar a sua conta inteira, fale com o Vitor.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Duração dos dados</h2>
        <p className="text-sm leading-relaxed">
          Suas reuniões e dados são mantidos enquanto sua conta estiver ativa. Quando você
          pede a exclusão, os dados são removidos pelo administrador.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Alterações nesta política</h2>
        <p className="text-sm leading-relaxed">
          Podemos atualizar esta política de privacidade ocasionalmente. A versão atual fica
          sempre nesta página.
        </p>
      </section>

      <footer className="border-t border-[color:var(--border)] pt-6 mt-8">
        <p className="text-xs text-[color:var(--muted)]">
          Esta política está disponível em português. Para questões sobre privacidade,
          fale com o Vitor.
        </p>
      </footer>
    </article>
  );
}
