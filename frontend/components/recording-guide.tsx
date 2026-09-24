"use client";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function RecordingGuide({ onConfirm, onBack }: { onConfirm: () => void; onBack: () => void }) {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="font-display text-2xl mb-4">Como compartilhar o áudio do computador</h2>
        <p className="text-[color:var(--muted-strong)] mb-6">
          São só 2 cliques. Veja como fazer em cada navegador:
        </p>
      </div>

      {isMac && (
        <div className="rounded-2xl border border-blue-600/30 bg-blue-600/10 p-6">
          <p className="text-sm text-blue-700">
            <strong>No Mac:</strong> você pode compartilhar apenas uma aba (som dela entra) ou a tela inteira (com som do sistema).
          </p>
        </div>
      )}

      <div className="space-y-6">
        {/* Chrome/Edge Guide */}
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-6">
          <h3 className="font-semibold text-lg mb-4">Chrome / Edge</h3>

          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">1º clique: escolha a aba ou tela</p>
              <div className="bg-[color:var(--background)] rounded-lg p-4 text-sm text-[color:var(--muted-strong)]">
                <svg viewBox="0 0 400 300" className="w-full max-w-sm mx-auto bg-white rounded" xmlns="http://www.w3.org/2000/svg">
                  <rect width="400" height="300" fill="white"/>
                  <text x="20" y="30" fontSize="16" fontWeight="bold" fill="#000">Selecione o que compartilhar</text>
                  <rect x="20" y="50" width="360" height="80" fill="#e8e8e8" stroke="#999" strokeWidth="2" rx="4"/>
                  <text x="30" y="110" fontSize="14" fill="#333">Esta aba</text>
                  <rect x="20" y="150" width="360" height="80" fill="#e8e8e8" stroke="#999" strokeWidth="2" rx="4"/>
                  <text x="30" y="210" fontSize="14" fill="#333">Tela inteira</text>
                </svg>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">2º clique: apareça "Compartilhar áudio do sistema"</p>
              <div className="bg-[color:var(--background)] rounded-lg p-4 text-sm text-[color:var(--muted-strong)]">
                <svg viewBox="0 0 400 200" className="w-full max-w-sm mx-auto bg-white rounded" xmlns="http://www.w3.org/2000/svg">
                  <rect width="400" height="200" fill="white"/>
                  <rect x="20" y="40" width="360" height="130" fill="#f5f5f5" stroke="#999" strokeWidth="1" rx="4"/>
                  <circle cx="50" cy="70" r="6" fill="#4CAF50"/>
                  <text x="70" y="75" fontSize="13" fill="#000">Compartilhar áudio do sistema</text>
                  <text x="40" y="120" fontSize="12" fill="#666">Se não aparecer, tente a "Tela inteira"</text>
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Firefox Note */}
        <div className="rounded-2xl border border-yellow-600/30 bg-yellow-600/10 p-6">
          <p className="text-sm text-yellow-700">
            <strong>Firefox:</strong> use Chrome ou Edge para gravar reunião online com mais facilidade.
          </p>
        </div>

        {/* Instructions */}
        <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-6 space-y-3">
          <p className="text-sm font-medium">O que você vai ouvir:</p>
          <ul className="text-sm text-[color:var(--muted-strong)] space-y-2">
            <li>• Você falando (microfone)</li>
            <li>• O que toca no seu computador (som da reunião)</li>
          </ul>
        </div>
      </div>

      <div className="flex gap-3 pt-4">
        <button
          onClick={onBack}
          className="px-6 py-3 rounded-lg border border-[color:var(--border)] text-[color:var(--foreground)] hover:bg-[color:var(--card)] transition"
        >
          Voltar
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 px-6 py-3 rounded-lg bg-[color:var(--foreground)] text-[color:var(--background)] font-medium hover:opacity-90 transition"
        >
          Entendi, começar
        </button>
      </div>
    </div>
  );
}
