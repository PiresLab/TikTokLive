# Reino em Guerra

Jogo interativo pra live 24h no TikTok. As 5 fases do plano original estão completas (ingestão → motor/client → ondas/chefão/persistência → season/Era/Hall da Fama → hardening 24/7 → polimento) e, depois delas, entraram o **upgrade gráfico** (cenário, castelo por Era, monstros, heróis, efeitos — tudo desenhado por código, com sprites opcionais) e o **painel admin** (ver tudo, controlar o jogo, injetar eventos de teste e ajustar balanceamento ao vivo). Validado com conexão real, injetor de eventos falsos, um crash de verdade sob PM2 (autorestart confirmado) e uma simulação de 24h de economia. 56 testes unitários passando.

## Setup

```bash
npm install
cp .env.example .env
```

Preenche `.env` com `TIKTOK_USERNAME` (obrigatório pra rodar com live real) e o que mais quiser configurar (webhook de alerta, OBS). Carregado automaticamente — `dev`, `dev:fake`, `pm2:start` e `watchdog` já leem o `.env` sozinhos, não precisa setar variável na mão toda vez. Variável passada direto no terminal (`$env:X=...`) tem prioridade sobre o `.env`.

## Rodar com uma live real (modo dev, sem PM2)

```bash
npm run dev -- <usuario_tiktok_sem_@>
```

(ou deixa `TIKTOK_USERNAME` no `.env` e roda só `npm run dev`, sem o argumento)

Conecta na live do usuário informado (precisa estar ao vivo), roda o motor e sobe:
- `http://localhost:8080` — página do client Phaser (fundo escuro sólido por padrão, bom pra testar em navegador normal). Pra usar como overlay transparente no OBS Browser Source, abra `http://localhost:8080/?transparent=1`.
- `http://localhost:8080/admin/` — **painel admin** (só aceita acesso do próprio computador; ver seção abaixo).
- `http://localhost:8080/health` — status pro watchdog (`{ok, lastEventAgoMs, uptimeSec}`).
- `ws://localhost:8787` — WS que o client consome.
- `data/reino.sqlite` — estatísticas por usuário (vitalícia + do dia), Hall da Fama e snapshot do estado (restaurado automaticamente se o processo cair e reiniciar).

Se o usuário não estiver ao vivo, a lib lança erro ao conectar — o client já agenda retry com backoff exponencial (2s → 60s) esperando a live começar.

## Painel admin

`http://localhost:8080/admin/` (funciona em `npm run dev` e `npm run dev:fake`).

- **Ver tudo em tempo real:** conexão do TikTok, quantos jogos/OBS conectados, health, uptime, estado do jogo (dia, Era, onda, HP do monstro/Reino, totais), feed ao vivo (com filtros), rankings, Hall da Fama e um **preview ao vivo do jogo** (o que está no OBS).
- **Controlar o jogo:** chefão agora, ir para onda N, curar/danificar o Reino, encerrar season (arquiva o dia de verdade no Hall da Fama — pede confirmação), `+Score` (pula de Era), pausar/retomar (pausado: nada de dano/cura/decaimento, mas os efeitos continuam).
- **Enviar teste na live:** botões rápidos (like ×20/×200, comentário, gifts Rosa/Perfume/GG/Leão/Galáxia, follow, share) e formulário com usuário/valor; **rajada** (N eventos/s por X segundos) pra teste de carga na live rodando. Evento de teste **afeta o jogo, os efeitos e o som, mas não grava no banco, no ranking nem nos totais/Era** — aparece com selo `TESTE` no feed do painel.
- **Balanceamento ao vivo:** edita dano por like/comentário/diamante/share, decaimento e cura do Reino, HP base/crescimento do monstro, chefão (frequência e multiplicador). Valida faixas seguras (ex.: crescimento de HP > 1.5×/onda é recusado — era assim que virava parede), vale na hora (HP/chefão valem na próxima onda) e **fica salvo no banco**; "Restaurar padrão" desfaz.

**Segurança:** não tem senha (decisão: só localhost). Em troca, o servidor só aceita admin de conexão local (IP do próprio PC), com `Host` `localhost`/`127.0.0.1` (barra DNS rebinding) e, nos comandos, JSON + header `X-Admin` e `Origin` local (barra CSRF de qualquer site aberto no seu navegador). O WebSocket do painel segue a mesma regra. Outra máquina da rede **não** acessa o painel (mesmo que acesse o jogo). Não exponha a porta 8080 pra internet/túnel: o jogo em si não tem problema, mas não use túnel que reescreva o `Host` pra `localhost`.

## Visual do jogo

Cenário em camadas (céu em gradiente que muda por Era, estrelas, lua, montanhas em parallax, chão), **castelo que evolui com a Era** (acampamento → vila → vila fortificada → cidade → capital, com bandeiras ao vento e tochas), 9 monstros/chefões desenhados por código (que entram andando, atacam a muralha, piscam ao tomar dano e explodem), **heróis** (cada follow vira um bonequinho com nome ao redor do castelo), projéteis do castelo até o monstro por tipo de evento (like = faísca, comentário = orbe, share = chuva de flechas, gift = orbe/cometa/raio+meteoros por tier), números de dano, shake e flash de tela, banners narrativos. Cenas especiais: chefão (céu vermelho + vinheta), queda do Reino (castelo desaba), nova season (nascer do sol), nova Era.

- **Sprites são opcionais:** sem nenhum arquivo, tudo é gerado por código. Pra trocar qualquer elemento por imagem sua, veja `public/assets/README.md` (chaves, tamanhos, `manifest.json`).
- `?lowfx=1` — reduz estrelas/partículas/parallax e limita a 30 fps (máquina fraca).
- `?era=0..4` — força o visual de uma Era (pra ajustar arte). `?transparent=1` — fundo transparente (OBS).
- Medido sob rajada de 60 eventos/s: ~143 fps estáveis (WebGL), sem erro de console.

## Rodar 24/7 com PM2 (produção)

```bash
npm run pm2:start
```

Lê o `.env` automaticamente (`ecosystem.config.cjs` carrega com `dotenv`). Builda (`tsc`) e sobe dois processos via `ecosystem.config.cjs`:
- **reino-em-guerra** — o jogo. `autorestart: true`, `max_memory_restart: 300M`.
- **reino-watchdog** — processo separado que só confere `/health` a cada 15s; se falhar 3 vezes seguidas, roda `pm2 restart reino-em-guerra` sozinho e manda alerta. Fica fora do processo principal de propósito: se o principal travar de um jeito que nem o event loop responde, só algo de fora consegue perceber.

Comandos úteis:
```bash
npx pm2 list                 # status dos dois processos
npm run pm2:logs             # logs em tempo real
npm run pm2:stop             # para os dois
npx pm2 save                 # salva a lista atual pra sobreviver reinício do PM2
npx pm2-startup install      # (uma vez, como admin) registra o PM2 como serviço do Windows no boot
```

Variáveis de ambiente opcionais (todas com fallback seguro se não setadas):
| Variável | Pra quê |
|---|---|
| `ALERT_WEBHOOK_URL` | Webhook (Discord-compatible, `{content: "..."}`) pra alertas críticos: processo caiu, TikTok desconectado >5min, watchdog reiniciando o app. |
| `OBS_WS_URL` | Ex: `ws://localhost:4455`. Liga a integração com obs-websocket v5 (ativar em OBS → Ferramentas → Configurações do WebSocket). |
| `OBS_WS_PASSWORD` | Senha do obs-websocket, se configurada. |
| `OBS_SOURCE_NAME` | Nome exato da Browser Source no OBS. Se o render client ficar 20s sem reconectar no WS, o app manda o OBS recarregar essa fonte sem cache. |

## Rodar sem live (eventos falsos)

```bash
npm run dev:fake
```

Mesma pipeline, mas gera `GameEvent` sintético (intervalo configurável via `INJECT_INTERVAL_MS`, default 1500ms) em vez de escutar o TikTok. Season dura só 40s (`SEASON_DURATION_MS`) pra dar pra ver o ciclo completo num teste curto. Usa `data/reino.dev.sqlite` (separado do banco real).

## Teste de carga

```bash
npm run loadtest
```

Dispara um burst síncrono de eventos só no `GameEngine` (sem WS/HTTP/DB) e confere que não trava, não gera `NaN`/HP negativo. No teste local: 20.000 eventos em ~7ms — muito acima de "milhares de likes/min". O gargalo real de produção é a escrita no SQLite por evento (`db.recordActivity`), testado à parte rodando `dev:fake` com `INJECT_INTERVAL_MS=20` (~50 eventos/s = 3.000/min sustentado) — `/health` seguiu respondendo `ok:true` sem acumular atraso.

## Balanceamento de economia

```bash
npm run balance
```

Simula 24h de engajamento "médio" (taxas assumidas no topo de `balanceSim.ts` — ajustar lá se o público real for diferente) através do motor, sem rede nem tempo real, e imprime onda/HP/Era por hora. Achei um problema real rodando isso: o crescimento original do HP do monstro (18%/onda composto) dobrava a cada ~4 ondas e virava parede por volta da onda 30 (chefão de ~109 mil HP) — a simulação travava **6 horas seguidas** sem progresso antes do Reino cair. Troquei pra 5%/onda (dobra a cada ~14 ondas): no mesmo cenário, onda 83 ao final do dia, só 1h de estagnação, Reino nunca caiu. Virou regressão automatizada em `GameEngine.test.ts` ("monster HP growth stays sustainable").

Interação que vale documentar: gift só dá dano, quem cura o Reino é follow (e um pouco cada onda vencida). Público que só manda presente e nunca segue ninguém vai ver o Reino cair com frequência — isso é intencional (dá peso real ao follow), mas é bom saber antes de estranhar ao vivo.

## Som

`public/sound.js` sintetiza efeito sonoro via Web Audio (osciladores simples, sem arquivo de áudio nenhum — nada pra faltar ou baixar numa live 24/7). Toca só nos momentos que importam: gift (3 níveis de intensidade), follow, share, onda vencida, chefão (surge/cai), queda do Reino, nova season. Like e comentário ficam mudos de propósito — acontecem o tempo todo e tocar som a cada um cansaria em horas de live. Botão de mudo no canto superior esquerdo do client (`🔊/🔇 som`), estado salvo no `localStorage`.

## Soft launch — checklist antes de ir ao ar de verdade

1. Rodar `npm run balance` de novo se mudar qualquer constante de dano/HP/cura em `GameEngine.ts` — é rápido e pega parede de dificuldade antes de descobrir ao vivo.
2. Testar o ciclo completo com `npm run dev:fake` (season curta) antes de testar com `npm run dev` numa live pequena de verdade.
3. Primeira live real: pública pequena, monitorar `/health` e os logs (`npm run pm2:logs` se estiver em PM2) pelas primeiras horas.
4. Configurar `ALERT_WEBHOOK_URL` antes do primeiro teste longo — é de graça (webhook do Discord) e avisa se algo cair enquanto você não tá olhando.
5. Depois de algumas horas reais, comparar os números de `npm run balance` com o que realmente aconteceu (`/api/leaderboard`, `data/reino.sqlite`) — se o público real tiver taxas de like/gift/comentário bem diferentes do assumido no script, ajustar as constantes `*_PER_MIN` do `balanceSim.ts` e as de dano/cura do `GameEngine.ts` juntas, e rodar a simulação de novo antes de mudar em produção.
6. Arte: pra subir o nível visual, solte PNGs em `public/assets/` e liste no `manifest.json` (ver `public/assets/README.md`) — o motor (`GameEngine.ts`) não muda nada nesse processo.
7. Antes de ir ao ar, use o painel admin (`/admin/`) pra mandar uma rajada de teste e um gift de cada tier e ver se o OBS aguenta e como fica na tela.

## Fase 0 — só testar ingestão (sem motor/client)

```bash
npm run dev:probe -- <usuario_tiktok_sem_@>
```

## Testes

```bash
npm test
```

## Estrutura

- `src/ingestion/tiktokClient.ts` — wrapper do `piratetok-live-js`, isola a lib não-oficial do resto do jogo.
- `src/ingestion/eventNormalizer.ts` — converte evento bruto do TikTok em `GameEvent` tipado.
- `src/types/GameEvent.ts` — schema interno de evento, único contrato que o motor do jogo consome.
- `src/app.ts` — fiação única (motor, WS, HTTP, banco, stats, season, OBS, admin). `index.ts` pluga o TikTok; `devInjector.ts` pluga eventos falsos.
- `src/gameEngine/GameEngine.ts` — estado do Reino: onda, HP do monstro/chefão, HP do Reino, season diária, Era do Reino, pausa e ações de admin. Testado em `GameEngine*.test.ts`.
- `src/gameEngine/balance.ts` — constantes de balanceamento (`DEFAULT_BALANCE`), faixas seguras e validação.
- `src/persistence/db.ts` — SQLite via `node:sqlite` nativo: `user_stats`, `daily_stats`, `hall_of_fame`, `settings` (balanceamento customizado), snapshot do jogo.
- `src/net/wsServer.ts` — broadcast de `state`/`fx`/`narrative`; papéis de socket (`render`/`preview`/`admin`); só `render` conta pra detectar queda do OBS.
- `src/net/staticServer.ts` — serve `public/`, o Phaser local (sem CDN), `/api/leaderboard`, `/health` e as rotas `/admin` + `/api/admin/*` (protegidas por `adminGuard.ts`).
- `src/admin/` — `commands.ts` (validação dos comandos), `adminApi.ts` (execução + status), `eventLog.ts` (feed do painel).
- `src/testing/fakeEvents.ts` — gerador de eventos falsos (dev:fake e rajada do admin).
- `src/ops/heartbeat.ts` — timestamp do último tick do motor; base do `/health`.
- `src/ops/alerts.ts` — `sendAlert(msg)` via webhook; no-op com log se não configurado.
- `src/ops/obsRefresh.ts` — força refresh da Browser Source via obs-websocket quando o render client some; opt-in via `OBS_WS_URL`.
- `src/ops/watchdog.ts` — processo PM2 separado: poll em `/health`, restart via CLI do PM2 após 3 falhas seguidas, com cooldown de 60s entre restarts.
- `src/index.ts` — entry real: ingestão → motor → WS/DB, heartbeat, watchdog de conexão TikTok (alerta após 5min desconectado), handlers de `uncaughtException`/`unhandledRejection` (loga, alerta, derruba o processo de propósito pro PM2 reiniciar limpo).
- `src/devInjector.ts` — entry de teste (eventos falsos, taxa configurável, banco separado, season curta).
- `src/loadTest.ts` — teste de carga isolado do motor.
- `src/balanceSim.ts` — simulação de 24h de economia (diagnóstico manual, `npm run balance`).
- `src/probe.ts` — script da Fase 0, só loga eventos.
- `ecosystem.config.cjs` — config do PM2 (app principal + watchdog).
- `public/index.html` + `public/js/*` — client Phaser em módulos: `theme` (constantes/paleta), `art` (texturas procedurais), `boot` (sprites opcionais), `background`, `kingdom`, `monsters`, `heroes`, `fx`, `ui` (HUD), `main` (cena + WebSocket).
- `public/admin/` — painel admin (HTML/CSS/JS vanilla). `public/assets/` — sprites opcionais.
- `public/sound.js` — efeitos sonoros sintetizados (Web Audio, sem arquivos).

## Mecânica

- Like/comentário/gift causam dano no monstro da onda atual (gift escala com valor em diamantes).
- Follow cura o Reino e vira um Herói permanente. Share dá um "ataque de reforço".
- Reino perde HP passivamente; se chegar a 0, a onda reseta (mas totais vitalícios não).
- A cada 5 ondas aparece um chefão (HP x6). Crescimento de HP por onda: 5%/onda composto (ver seção de balanceamento acima pra entender por quê não é mais que isso).
- Season diária (24h, configurável): onda reseta, topo do dia vai pro Hall da Fama.
- Era do Reino: tier vitalício (Acampamento → Vila → Vila Fortificada → Cidade → Capital do Reino), nunca reseta.

## Daqui pra frente

As 5 fases do plano original estão implementadas e testadas localmente. O que falta é inerentemente dependente de uso real e não dá pra fazer por simulação: rodar numa live de verdade por várias horas, ver como o público real se comporta, ajustar as taxas assumidas em `balanceSim.ts`/constantes do `GameEngine.ts` com dado real, e decidir se/quando vale subir o nível da arte (estrutura já preparada pra isso sem mexer no motor).
