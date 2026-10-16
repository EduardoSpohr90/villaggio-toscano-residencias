import { useRef, useState } from 'preact/hooks';
import { engine } from '../services/engine';
import { readJSON, writeJSON, KEYS } from '../services/storage';
import { Sheet } from './Sheet';
import { useEngine } from './common';

const STATUS_TEXT: Record<string, string> = {
  loading: 'Carregando…',
  local: 'Somente neste aparelho',
  synced: 'Sincronizado com o Google Calendar',
  syncing: 'Sincronizando…',
  offline: 'Você está offline. As alterações ficam salvas e serão enviadas quando a conexão voltar.',
  error: 'Não foi possível sincronizar. Uma nova tentativa será feita em instantes.',
  'signed-out': 'Sua conexão com o Google expirou. Entre novamente para continuar sincronizando.',
  setup: 'Conectado. Falta o calendário compartilhado da família.',
};

export function AccountSheet({ onClose, onPrefs }: { onClose: () => void; onPrefs: () => void }) {
  const s = useEngine();
  const me = s.me;
  const file = useRef<HTMLInputElement>(null);
  const [prefs, setPrefs] = useState(() => readJSON<{ showObservances?: boolean }>(KEYS.prefs, {}));
  const last = s.lastSync ? new Date(s.lastSync).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '—';
  const hasLocal = engine.hasLocalData();

  const pickFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files && input.files[0];
    if (!f) return;
    const text = await f.text();
    await engine.importFile(f.name, text);
    input.value = '';
  };

  const download = () => {
    const blob = new Blob([engine.backupJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nosso-calendario-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <Sheet title="Conta e sincronização" onClose={onClose} testId="account-sheet" left={null} right={<button type="button" class="text-btn" onClick={onClose}>OK</button>}>
      <p style={{ marginTop: 0 }} data-testid="sync-text">{STATUS_TEXT[s.status]}</p>

      {me && me.authenticated ? (
        <ul class="kv">
          <li><span>Conta</span><span>{me.email}</span></li>
          <li><span>Pessoa</span><span>{me.person ? s.labels[me.person] : '—'}</span></li>
          <li><span>Calendário</span><span>{me.calendar ? me.calendar.summary : `“${me.calendarName}” não encontrado`}</span></li>
          <li><span>Última sincronização</span><span>{last}</span></li>
          <li><span>Alterações pendentes</span><span>{s.queueSize}</span></li>
        </ul>
      ) : null}

      <div class="choice-list">
        {me && me.configured === false ? (
          <p class="help" style={{ margin: 0 }}>
            A conexão com o Google ainda não foi configurada no servidor. Os compromissos ficam salvos neste aparelho e poderão ser importados depois.
          </p>
        ) : null}

        {(!me || !me.authenticated) && !(me && me.configured === false) ? (
          <>
            <button type="button" class="btn primary block" onClick={() => engine.login()}>Entrar com Google</button>
            <p class="help" style={{ margin: 0 }}>Somente as contas autorizadas da família têm acesso. Sua senha nunca passa pelo app.</p>
          </>
        ) : null}

        {s.status === 'setup' ? (
          <>
            <button type="button" class="btn primary block" onClick={() => engine.setupCalendar()}>
              Criar calendário “{(me && me.calendarName) || 'Família Spohr'}”
            </button>
            <p class="help" style={{ margin: 0 }}>
              Se o calendário já foi criado pela outra pessoa, aceite o convite recebido por e-mail e toque em “Verificar de novo”.
            </p>
            <button type="button" class="btn block" onClick={() => engine.syncNow()}>Verificar de novo</button>
          </>
        ) : null}

        {s.mode === 'google' && s.status !== 'signed-out' ? (
          <button type="button" class="btn block" onClick={() => engine.syncNow()}>Sincronizar agora</button>
        ) : null}

        {s.mode === 'google' && hasLocal ? (
          <button type="button" class="btn block" onClick={() => engine.importMigration()}>Importar compromissos deste aparelho</button>
        ) : null}

        <button type="button" class="btn block" onClick={() => file.current && file.current.click()}>Importar arquivo (.ics ou .json)</button>
        <input ref={file} type="file" accept=".ics,.json,text/calendar,application/json" hidden onChange={pickFile} />
        <button type="button" class="btn block" onClick={download}>Exportar cópia de segurança</button>

        <div class="switch-row" style={{ marginTop: '6px' }}>
          <label for="pref-obs">Mostrar datas comemorativas</label>
          <span class="switch">
            <input
              id="pref-obs"
              type="checkbox"
              role="switch"
              checked={!!prefs.showObservances}
              onChange={(e) => {
                const next = { ...readJSON(KEYS.prefs, {}), showObservances: (e.target as HTMLInputElement).checked };
                writeJSON(KEYS.prefs, next);
                setPrefs(next);
                onPrefs();
              }}
            />
            <span />
          </span>
        </div>

        {me && me.authenticated ? (
          <button type="button" class="btn danger block" onClick={() => engine.logout()}>Sair neste aparelho</button>
        ) : null}
        <p class="help" style={{ textAlign: 'center' }}>Nosso Calendário · versão {__APP_VERSION__}</p>
      </div>
    </Sheet>
  );
}
