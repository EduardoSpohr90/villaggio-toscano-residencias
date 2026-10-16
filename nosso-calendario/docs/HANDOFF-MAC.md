# MISSÃO — FINALIZAR E PUBLICAR O "NOSSO CALENDÁRIO"

Você está no meu Mac, na raiz do repositório `villaggio-toscano-residencias`, branch `claude/nosso-calendario`. O app está em `nosso-calendario/`. Responda em português do Brasil. Trabalhe sozinho e pare apenas em passos que exigem minha mão (login, colar segredo, decisão), marcados como **AÇÃO NECESSÁRIA**, dizendo exatamente o que eu devo fazer.

## Contexto (estado em 16/10/2026)

- App: PWA familiar (Eduardo, Esposa, Casal). O Google Calendar é a fonte da verdade, acessado por Vercel Functions. Stack: Preact + TypeScript + Vite. Funções em `nosso-calendario/api/`, sem dependências npm. Lógica compartilhada em `shared/`.
- **Leia `nosso-calendario/README.md` antes de qualquer ação.** Ele traz arquitetura, variáveis, configuração do Google e deploy.
- Testes: 78 unitários/integração (Vitest) e 26 E2E (Playwright, perfil iPhone 14, Google falso), todos passando em Chromium. **WebKit nunca foi rodado.**
- PR #1 (rascunho): https://github.com/EduardoSpohr90/villaggio-toscano-residencias/pull/1
- Vercel: equipe `dimensao`, projeto `nosso-calendario` (`prj_0xqi5jR4YQkETgOsJatg8KSBoINY`), produção em `https://nosso-calendario-five.vercel.app`, Root Directory `nosso-calendario`. **Nenhum deploy bem-sucedido até agora.**
- A sessão anterior, na nuvem, não tinha conexão Vercel↔GitHub e tentou um contorno (`deploy/vercel-bootstrap/`, Build Output API). O contorno falhou e deixou resíduos no projeto: Install Command `echo bootstrap`, Build Command `node vercel-build.mjs` ou `node diag-build.mjs`, e a variável `NC_SOURCE_COMMIT`. **Tudo isso deve ser desfeito.**
- Variáveis já existentes na Vercel: `APP_URL`, `FAMILY_CALENDAR_NAME`, `ALLOWED_USERS`, `NC_SOURCE_COMMIT`. Faltam: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `SESSION_SECRET` (recomendado).

## Regras invioláveis

- Nunca mostre, imprima, registre ou peça no chat: client secret, refresh token, `SESSION_SECRET` ou qualquer credencial. Segredo entra na Vercel por pipe, sem ser exibido, ou digitado por mim num terminal separado.
- Não versionar `.env*` nem `.vercel/`.
- Não apagar eventos reais do Google. Testes de escrita só no calendário "Família Spohr", com títulos `[TESTE]`, removidos ao final.
- Não publicar a agenda como pública. Acesso apenas para os e-mails em `ALLOWED_USERS`.
- Não afirmar que algo funciona sem testar. Não pular, desativar nem enfraquecer teste para ficar verde.
- Não inventar dados (e-mails, IDs). Se faltar, pergunte.
- Commits pequenos e lógicos na branch `claude/nosso-calendario`. Nada de force-push.

## Etapas

### 1. Ambiente e testes locais

1. Confirme Node 22 (`node -v`) e git. Se faltar, instale (nvm ou Homebrew).
2. `cd nosso-calendario && npm ci`
3. `npm run typecheck && npm run build && npm test`. Esperado: 78 passando. O teste de compatibilidade do bundle precisa do build feito antes.
4. `npx playwright install chromium webkit`
5. `npm run test:e2e` (Chromium, esperado 26) e a mesma suíte em WebKit (veja `playwright.config.ts`, variável `PW_WEBKIT`). Falha em WebKit é bug real de iPhone: corrija a causa e rode tudo de novo.

### 2. Limpar o contorno e fixar a configuração no código

1. Em `nosso-calendario/vercel.json`, garanta `"framework": null`, `"installCommand": "npm ci"`, `"buildCommand": "npm run build"` e `"outputDirectory": "dist"`. Assim o projeto não depende do que está no painel.
2. Remova `deploy/vercel-bootstrap/` e a seção correspondente do README.
3. Rode os testes de novo e faça o commit.

### 3. Vercel CLI

1. `npx vercel@latest login` (**AÇÃO NECESSÁRIA** se pedir confirmação no navegador).
2. Na **raiz do repositório**, não dentro de `nosso-calendario/`, porque o Root Directory já aponta para ela:
   `npx vercel link --yes --scope dimensao --project nosso-calendario`
3. Remova o resíduo: `npx vercel env rm NC_SOURCE_COMMIT production --yes` e o mesmo para `preview`.
4. `npx vercel env ls`: confira os nomes, sem exibir valores. Confirme que `APP_URL` = `https://nosso-calendario-five.vercel.app`. Para isso, puxe para um arquivo temporário fora do repositório, leia só essa chave e apague o arquivo.
5. `SESSION_SECRET`, gerado e enviado sem exibir:
   `openssl rand -base64 48 | tr -d '\n' | npx vercel env add SESSION_SECRET production`
   Use `--sensitive` se a CLI aceitar; confira em `vercel env add --help`.

### 4. Primeiro deploy (modo "neste aparelho", ainda sem Google)

1. Na raiz: `npx vercel deploy --prod`. Acompanhe o log e confirme que rodou `npm ci` e `npm run build`. Corrija qualquer erro e repita.
2. Validação em produção:
   - `curl -sI https://nosso-calendario-five.vercel.app/`: CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `X-Robots-Tag: noindex`.
   - `/sw.js` com `Cache-Control: no-cache`. `/manifest.webmanifest` e os ícones 180, 192 e 512 respondendo 200.
   - `/api/me` responde 200 em JSON, com `configured:false` até existir a credencial Google.
   - Smoke test Playwright contra a URL de produção, iPhone 14 em **WebKit**: o app abre; "+ Novo" abre com um toque em todas as visões; um compromisso local salvo permanece após recarregar.
   - Lighthouse mobile na URL de produção. Metas: Performance ≥ 90, Acessibilidade ≥ 95, Boas práticas ≥ 95.

### 5. Google Cloud (OAuth)

Se a extensão Claude in Chrome estiver conectada, faça isso comigo no navegador. Se não estiver, me guie tela a tela, seguindo a seção do Google no README.

1. Crie um projeto no Google Cloud (ex.: "Nosso Calendário") e ative a **Google Calendar API**.
2. Tela de consentimento:
   - Tipo externo, nome do app e e-mail de suporte.
   - Escopos: `openid`, `email`, `profile` e `https://www.googleapis.com/auth/calendar`.
   - Publique como **Em produção**. Em "Teste", o refresh token expira em 7 dias e o app desloga toda semana.
   - O aviso de "app não verificado" é esperado para uso familiar: entrar por "Avançado".
3. Credencial OAuth do tipo "Aplicativo da Web":
   - Origem JavaScript: `https://nosso-calendario-five.vercel.app`
   - URI de redirecionamento: `https://nosso-calendario-five.vercel.app/api/auth/callback`
4. **AÇÃO NECESSÁRIA**: eu mesmo, em outra aba do Terminal, na raiz do repositório, colo os valores quando a CLI pedir (nunca no chat):
   - `npx vercel env add GOOGLE_CLIENT_ID production`
   - `npx vercel env add GOOGLE_CLIENT_SECRET production` (com `--sensitive`, se aceito)
5. **AÇÃO NECESSÁRIA**: me pergunte qual é a minha conta Google e qual é o e-mail Google da minha esposa. Atualize `ALLOWED_USERS` no formato `eduardo:<email>,esposa:<email>`: remover e adicionar a variável de novo. Isso precisa estar certo **antes** de criar o calendário, porque é nesse momento que o app compartilha o "Família Spohr" com ela.
6. Faça um novo deploy de produção.

### 6. Validação real com o Google

1. **AÇÃO NECESSÁRIA**: eu entro no app com a minha conta e crio o calendário "Família Spohr" pelo próprio app.
2. Você confere, pela API ou pelo Google Calendar web, que o calendário existe, é privado e está compartilhado com a esposa como editora.
3. Teste ponta a ponta com eventos `[TESTE]`, conferindo cada item no Google Calendar:
   - criar, editar e excluir;
   - evento recorrente semanal, nas três opções: "somente este", "este e os próximos" e "toda a série";
   - tarefa marcada como concluída;
   - conflito de horário detectado;
   - feriados vindos do Google;
   - offline: criar sem rede e, ao voltar a rede, sincronizar sem duplicar.
4. **AÇÃO NECESSÁRIA**: minha esposa entra pelo iPhone dela e vê os mesmos eventos.
5. Remova todos os eventos `[TESTE]`.

### 7. iPhone real

**AÇÃO NECESSÁRIA**: no meu iPhone, abro a URL no Safari → Compartilhar → Adicionar à Tela de Início → abro pelo ícone → entro.

Peça que eu confirme quatro pontos:
- o app abre em tela cheia;
- "+ Novo" abre com um toque;
- o teclado não cobre os campos;
- os eventos sincronizam.

### 8. Fechamento

1. README atualizado: deploy pela CLI, sem o bootstrap, e números de testes reais.
2. Commits e push na branch. Atualize a descrição do PR #1.
3. Pergunte, sem executar antes da minha resposta:
   - (a) se devo fazer o merge do PR #1 em `main`;
   - (b) se devo conectar o GitHub na Vercel para deploy automático (Conta Vercel → Authentication → Connect GitHub; Projeto → Settings → Git).

## Relatório final (neste formato)

STATUS · URL · PWA · GOOGLE CALENDAR · TESTES (números reais, Chromium e WebKit) · SEGURANÇA · PENDÊNCIAS · COMO INSTALAR NO IPHONE (até 4 passos) · PRÓXIMA MELHORIA.

Separe com clareza o que foi testado de verdade e o que não foi.
