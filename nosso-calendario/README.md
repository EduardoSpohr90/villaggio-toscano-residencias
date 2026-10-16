# Nosso Calendário

Agenda compartilhada da família (Eduardo, Esposa e Casal) para uso diário no iPhone, instalada como app (PWA). O **Google Calendar é a fonte da verdade**: o app lê e grava no calendário compartilhado **Família Spohr**.

- Produção: **https://nosso-calendario-five.vercel.app**
- Visões: **Ano · Mês · Semana · Agenda · Semana do casal**
- Duas camadas visuais em todo item: **pessoa** (cor + avatar) e **categoria** (ícone)
- Tarefas, recorrências (RFC 5545), conflitos, feriados (Brasil, SC, Chapecó), filtros combináveis
- Funciona offline: alterações ficam numa fila e sincronizam quando a conexão volta, sem duplicar

---

## Arquitetura

```
iPhone (PWA)                           Vercel                              Google
┌─────────────────────────┐   HTTPS   ┌──────────────────────────┐  OAuth  ┌────────────────────────┐
│ Preact + TypeScript     │ ───────▶  │ /api/* (Node, sem deps)  │ ──────▶ │ Calendar API v3        │
│ cache offline + fila    │  cookie   │ sessão cifrada AES-GCM   │         │  • Família Spohr       │
│ service worker (shell)  │  HttpOnly │ allowlist de e-mails     │         │  • Feriados no Brasil  │
└─────────────────────────┘           │ CSRF, CSP, validação     │         │  • free/busy pessoais  │
                                      └──────────────────────────┘         └────────────────────────┘
```

| Camada | Arquivos | Papel |
|---|---|---|
| Domínio compartilhado | `shared/` | Datas em America/Sao_Paulo, recorrência, `detectConflicts()`, feriados, mapeamento app ↔ Google, validação. Usado pelo app e pela API. |
| API (Vercel Functions) | `api/` | OAuth (código + PKCE), sessão, CRUD com escopo de recorrência, feriados, free/busy, criação do calendário. |
| App | `src/` | Visões, formulário (bottom sheet), motor de sincronização (`services/engine.ts`), migração, service worker. |
| Testes | `tests/` | Unitários e de integração (Vitest) e E2E no perfil iPhone (Playwright) contra um Google falso. |

### Por que esta stack

- **Preact + TypeScript + Vite** (não React): mesmo modelo de componentes, 4 KB de runtime. O JSX escapa todo texto por padrão (proteção contra XSS em títulos/observações) e os componentes deixam as 5 visões e o formulário testáveis. Bundle final: ~33 KB JS + 6 KB CSS (gzip).
- **Sem Tailwind, sem Workbox, sem biblioteca de calendário**: CSS próprio com tokens, service worker de ~60 linhas e lógica de calendário própria, testada. Menos dependências = menos superfície de ataque e de quebra.
- **API sem dependências npm**: só `fetch` e `node:crypto`. Não há SDK do Google para atualizar nem vulnerabilidade transitiva.
- **Sem banco de dados**: o Google guarda os compromissos; a sessão é um cookie cifrado. Nada a manter.

### Modelo de dados no Google

- Título limpo em `summary`. Metadados do app em `extendedProperties.private`:
  `nc_owner` (eduardo/esposa/casal), `nc_category`, `nc_kind` (event/task), `nc_task` (pending/done), `nc_source`, `nc_by` (e-mail da sessão — nunca enviado pelo cliente), `nc_migration`.
- A **cor do evento no Google = responsável** (Eduardo azul, Esposa rosa, Casal verde; tarefa concluída grafite). Evento criado direto no app do Google com essas cores aparece com o responsável certo no Nosso Calendário.
- Horários enviados como hora local + `timeZone: America/Sao_Paulo`. Dia inteiro usa `date` com fim exclusivo (padrão do Google).
- Recorrência: `RRULE:FREQ=DAILY|WEEKLY|MONTHLY|YEARLY` com `INTERVAL`, `BYDAY`, `COUNT`, `UNTIL`. Edição pergunta **somente este / este e os próximos / toda a série**.
- Criação idempotente: o ID do evento é gerado no aparelho (base32hex, aceito pelo Google). Reenviar após queda de conexão devolve 409 e o app trata como sucesso — sem duplicar.

### Privacidade (agendas individuais)

`BUSY_SOURCES` permite mostrar agendas pessoais/profissionais **apenas como "Ocupado"**. A consulta usa a API free/busy do Google, que devolve somente intervalos — título e descrição nunca saem do Google. Cada pessoa controla o que a outra vê em *Google Agenda > Configurações > Compartilhar com pessoas específicas > "Ver apenas livre/ocupado"*.

---

## Como rodar localmente

Requisitos: Node 20+.

```bash
cd nosso-calendario
npm ci
npm run build                      # typecheck + build
node scripts/dev-server.mjs 4173   # mesmo roteamento e cabeçalhos da Vercel
```

Sem variáveis de ambiente, o app abre no modo **"Neste aparelho"** (dados locais). Para testar o fluxo completo sem credenciais reais, use o Google falso:

```bash
node tests/support/fake-google.mjs 4100 &
GOOGLE_CLIENT_ID=test-client GOOGLE_CLIENT_SECRET=test-secret \
ALLOWED_USERS=eduardo:eduardo@example.com \
GOOGLE_OAUTH_AUTHORIZE_URL=http://127.0.0.1:4100/o/oauth2/v2/auth \
GOOGLE_OAUTH_TOKEN_URL=http://127.0.0.1:4100/token \
GOOGLE_CALENDAR_API_BASE=http://127.0.0.1:4100/calendar/v3 \
node scripts/dev-server.mjs 4173
```

Com credenciais reais, crie `.env.local` a partir de `.env.example` (o servidor local carrega esse arquivo) e cadastre `http://localhost:4173/api/auth/callback` como URI de redirecionamento no Google.

### Testes

```bash
npm test            # 78 testes unitários e de integração (Vitest), rodando no fuso de Tóquio de propósito
npm run test:e2e    # 26 testes E2E no perfil iPhone 14 (Playwright) contra o Google falso
PW_WEBKIT=1 npm run test:e2e   # também no WebKit, onde o navegador estiver instalado
```

---

## Configurar o Google (OAuth + Calendar API)

1. **Projeto**: https://console.cloud.google.com → *Novo projeto* → "Nosso Calendário".
2. **API**: *APIs e serviços > Biblioteca* → **Google Calendar API** → *Ativar*.
3. **Tela de consentimento** (*APIs e serviços > Tela de consentimento OAuth*, ou *Google Auth Platform*):
   - Tipo: **Externo**. Nome do app: Nosso Calendário. E-mail de suporte: o seu.
   - Escopos: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/calendar`.
   - **Status de publicação: "Em produção"**. Em "Teste", o Google expira o acesso a cada 7 dias e vocês teriam de entrar de novo toda semana. Sem verificação, o Google mostra o aviso "app não verificado" no primeiro login: toque em *Avançado > Acessar Nosso Calendário*. É esperado para app de uso pessoal (limite de 100 usuários).
4. **Credencial**: *Credenciais > Criar credenciais > ID do cliente OAuth* → **Aplicativo da Web**.
   - Origens JavaScript autorizadas: `https://nosso-calendario-five.vercel.app`
   - URIs de redirecionamento autorizados: `https://nosso-calendario-five.vercel.app/api/auth/callback`
5. Copie **ID do cliente** e **Chave secreta** direto para a Vercel (próxima seção). Não envie por chat ou e-mail.

### Por que o escopo completo do Calendar

O app cria o calendário "Família Spohr", compartilha com a esposa (ACL), lê e grava eventos e consulta free/busy. Os escopos granulares cobririam parte disso, mas a criação + compartilhamento + free/busy exigiriam vários escopos novos; o completo é o mais previsível. O acesso fica restrito pela allowlist do servidor (`ALLOWED_USERS`).

---

## Variáveis de ambiente

| Variável | Obrigatória | Exemplo / descrição |
|---|---|---|
| `GOOGLE_CLIENT_ID` | sim | ID do cliente OAuth |
| `GOOGLE_CLIENT_SECRET` | sim | Chave secreta (tipo *Sensitive* na Vercel) |
| `ALLOWED_USERS` | sim | `eduardo:email1@gmail.com,esposa:email2@gmail.com` |
| `FAMILY_CALENDAR_NAME` | não | `Família Spohr` (padrão) |
| `FAMILY_CALENDAR_ID` | não | ID fixo do calendário (`...@group.calendar.google.com`). Recomendado depois de criado. |
| `PERSON_LABELS` | não | `eduardo:Eduardo,esposa:Ana,casal:Casal` |
| `BUSY_SOURCES` | não | `eduardo:pessoal@gmail.com\|trabalho@empresa.com,esposa:outra@gmail.com` |
| `APP_URL` | produção | `https://nosso-calendario-five.vercel.app` (obrigatória com domínio próprio) |
| `SESSION_SECRET` | não | 32+ caracteres. Sem ela, a chave da sessão é derivada do client secret (HKDF). Trocar este valor desconecta todos os aparelhos. |

`.env` e `.env.*` não são versionados (`.gitignore`). Modelo em `.env.example`.

---

## Deploy na Vercel

Projeto: **nosso-calendario** (`prj_0xqi5jR4YQkETgOsJatg8KSBoINY`), diretório raiz `nosso-calendario`, build `npm run build`, saída `dist`, Node 22. As funções em `api/` são publicadas automaticamente.

Com o GitHub conectado à Vercel, cada push na branch de produção publica sozinho. Manualmente: `npx vercel --prod` dentro de `nosso-calendario/`.

Cabeçalhos (`vercel.json`): CSP restritiva (`script-src 'self'`), HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `noindex`. `sw.js` e `index.html` sem cache; `/assets/*` imutável; `/api/*` `no-store`.

Proteção da Vercel: as URLs de cada deploy e as prévias exigem login Vercel; o domínio de produção é aberto, e **os dados só aparecem após login Google de uma conta autorizada**.

### Domínio próprio (futuro)

1. Vercel > Project > Domains > adicionar (ex.: `agenda.seudominio.com.br`).
2. `APP_URL=https://agenda.seudominio.com.br`.
3. No Google, adicionar a nova origem e `https://agenda.seudominio.com.br/api/auth/callback`.

---

## Compartilhar o calendário

1. Eduardo entra no app (*✓/status > Entrar com Google*) e toca **Criar calendário "Família Spohr"**. O app cria o calendário e o compartilha (permissão de edição) com o e-mail da esposa em `ALLOWED_USERS`.
2. A esposa recebe um e-mail do Google e toca **Adicionar este calendário**.
3. Ela abre o app e entra com a conta dela.
4. Opcional: copie o ID do calendário (Google Agenda > Configurações do calendário > *Integrar agenda*) para `FAMILY_CALENDAR_ID`.

Lembretes: o Google envia notificações por pessoa. O lembrete definido no app vale para quem criou; a outra pessoa recebe conforme as notificações padrão dela para o calendário "Família Spohr" (Google Agenda > Configurações do calendário > *Notificações de eventos*).

## Instalar no iPhone

1. Abra **https://nosso-calendario-five.vercel.app** no **Safari**.
2. Toque em **Compartilhar** (quadrado com seta).
3. **Adicionar à Tela de Início** → confirme o nome → **Adicionar**.
4. Abra pelo ícone e entre com Google (o app instalado tem login próprio, separado do Safari).

## Como atualizar

Publicar na Vercel basta. O app verifica nova versão ao abrir e a cada 30 min; quando houver, mostra **"Nova versão disponível — Atualizar"**. Um toque ativa a nova versão e recarrega. Ninguém fica preso em versão antiga: `sw.js` nunca é cacheado e a versão do cache muda a cada build.

---

## Diagnóstico de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "+ Novo" não abre | Versão antiga em cache ou erro de script antes do clique | Feche e reabra o app; se aparecer "O aplicativo não abriu como esperado", toque **Recarregar** (limpa o service worker e o cache). |
| "Entrar novamente" | Acesso ao Google expirou ou foi revogado | Toque no status e entre de novo. Se acontecer toda semana: a tela de consentimento está em "Teste" — publique em produção. |
| "Configurar" | Conectado, mas o calendário "Família Spohr" não foi encontrado | Eduardo: *Criar calendário*. Esposa: aceitar o convite do e-mail e tocar *Verificar de novo*. |
| "Esta conta Google não tem acesso" | E-mail fora de `ALLOWED_USERS` | Ajuste a variável na Vercel e publique de novo. |
| "Offline" | Sem conexão | Continue usando; as alterações ficam na fila e são enviadas quando a conexão voltar. |
| "Erro de sincronização" | Google indisponível ou limite de requisições | Nova tentativa automática em 30 s; detalhes em Vercel > Logs. |
| Login falha no app instalado | Cookie do Safari não vale no app da Tela de Início | Entre de dentro do app instalado. |

Logs técnicos: Vercel > Project > Logs (o app só mostra mensagens humanas).

### Bug histórico do "+ Novo" no iPhone

O código antigo não estava disponível para análise. As causas conhecidas desse sintoma no WebKit, e como esta versão as elimina:

| Causa | Proteção nesta versão |
|---|---|
| `<dialog>.showModal()` inexistente (iOS < 15.4) lança erro no toque | Modal próprio, sem `<dialog>` (`src/components/Sheet.tsx`) |
| `click` não dispara em elemento não clicável no iOS (div com listener) | Botão real `<button type="button">`; células clicáveis com `cursor: pointer` |
| Exceção anterior impede o registro dos eventos (ex.: `localStorage` em modo privado) | Todo acesso a armazenamento protegido (`services/storage.ts`); teste E2E com armazenamento bloqueado |
| Service worker servindo JS antigo | Cache versionado por conteúdo, aviso de atualização e recuperação em `boot.js` |
| Overlay invisível por cima do botão / scroll lock quebrado | Overlay só existe com o modal aberto; trava de scroll própria para iOS |
| API JS nova demais (`Array.at`, `structuredClone`) | Build com alvo Safari 15 |

---

## Segurança

- Client secret, refresh token e access token **só no servidor**. O navegador recebe um cookie `__Host-` HttpOnly, Secure, SameSite=Lax, cifrado com AES-256-GCM.
- OAuth com `state` + PKCE (S256); `id_token` conferido (emissor, audiência, validade, e-mail verificado).
- Allowlist por e-mail em todas as rotas; a pessoa da sessão vem do servidor, nunca do cliente.
- CSRF: cookie SameSite, cabeçalho próprio obrigatório e verificação de `Origin` em toda alteração.
- Entrada validada no servidor (responsável, categoria, datas, RRULE em lista branca, limites de tamanho).
- Sem CORS aberto; CSP sem `unsafe-inline` para scripts; respostas da API `no-store` e nunca cacheadas pelo service worker.
