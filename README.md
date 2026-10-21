# TalkChess ♞

Xadrez por voz: você fala o lance, o **Stockfish** responde. Integra com o **Lichess** para perfil, puzzles, importação e análise.

## Como rodar

```bash
npm install     # instala e copia o Stockfish (WASM) para public/stockfish
npm run dev     # http://localhost:5173
npm test        # testes (parser de voz, motor, regras)
npm run build   # build de produção em dist/ (qualquer host estático)
```

Requer Node 18+ e, para voz, **Chrome ou Edge** (Web Speech API). Em navegadores sem reconhecimento de voz
(ex.: Firefox) use o campo de texto, que passa pelo mesmo interpretador.

## Docker (colocar no ar com senha)

O app é estático; a imagem faz o build e serve tudo com **nginx**, com **senha obrigatória** (HTTP Basic Auth) em todo o site.

```bash
cp .env.example .env      # edite APP_USER, APP_PASSWORD e TALKCHESS_PORT
docker compose up -d --build
# http://localhost:3002  → o navegador pede usuário e senha
```

- A senha fica guardada no arquivo `.env` (fora do git). `APP_PASSWORD` é obrigatória: sem ela o container não sobe.
  Para trocar a senha, edite o `.env` e rode `docker compose up -d`.
- A porta padrão é **3002** (o projeto Racoes-Agricolas usa 3000, 3001 e 5432), então os dois podem rodar juntos.
- Sem compose: `docker build -t talkchess .` e
  `docker run -d -p 3002:3002 -e APP_USER=admin -e APP_PASSWORD='sua-senha' talkchess`.
- **Use HTTPS em produção.** A senha (Basic Auth) trafega em texto simples em HTTP, e o navegador só libera o
  **microfone** em HTTPS (ou `localhost`). Coloque na frente um proxy com TLS (Caddy, Traefik, Nginx Proxy Manager,
  Cloudflare Tunnel…) apontando para a porta do container.
- `/healthz` responde sem senha (usado pelo healthcheck do Docker).

## Funcionalidades

- **Voz → lance**: “e quatro”, “cavalo efe três”, “bispo toma cê seis”, “roque curto”, “e dois para e quatro”…
  Português e inglês. Ambiguidades (dois cavalos na mesma casa) mostram as opções e pedem a casa de origem.
- **Comandos por voz**: desfazer, dica, girar tabuleiro, oferecer empate, desistir / nova partida (com confirmação “sim”/“cancelar”), repetir.
- **Stockfish 19 (WASM, no navegador)** com **rating ajustável de 400 a 3200** (`UCI_Elo` a partir de 1320; abaixo disso
  Skill Level + profundidade rasa + erros ocasionais) e **jogar de brancas, pretas ou aleatório**. Pode mudar a força durante o jogo.
- O Stockfish **fala o lance** (síntese de voz) e o microfone pausa enquanto isso.
- Tabuleiro com clique, arrastar, lances legais, promoção, último lance, xeque, material capturado, temas e sons.
- **Relógio** opcional (3, 5, 10, 15+10, 30 min), empate por acordo (o Stockfish avalia se aceita), tripla repetição, 50 lances etc.
- **Barra de avaliação** e melhor linha com um segundo Stockfish em força total; **dica** de melhor lance.
- **Lichess**: perfil e ratings, **puzzle do dia** (resolvível por voz), importar partida por link/ID/PGN para **revisão** com
  análise do Stockfish (e “Jogar a partir daqui”), **exportar a partida para o Lichess** para análise.
- Copiar PGN/FEN.

## Atalhos

`Espaço` liga/desliga o microfone · `←` `→` navegam pelos lances · `F` gira o tabuleiro.

## Arquitetura

```
src/
  lib/engine.ts          wrapper UCI do Stockfish (Web Worker) + mapeamento rating → força
  lib/voice/parser.ts    fala → restrições → lances legais (chess.js); testado em parser.test.ts
  lib/voice/speech.ts    reconhecimento (SpeechRecognition) e síntese (speechSynthesis)
  lib/lichess.ts         cliente da API pública do Lichess
  lib/game.ts            estado da partida, resultado, PGN, material, avaliação
  components/            tabuleiro, voz, lances, painéis de Lichess e ajustes
  App.tsx                orquestra motor, voz, relógio, revisão e puzzles
```

Não há backend: o motor roda no navegador (single-thread, sem exigir cross-origin isolation) e a API do Lichess é consumida
direto do cliente.

## Notas sobre o Lichess

- A listagem de **partidas recentes de um usuário** exige login no Lichess atualmente; sem ele o app mostra o perfil e
  orienta a importar a partida pelo link/ID.
- Exportar para o Lichess usa `POST /api/import` (anônimo); se falhar, abre o tabuleiro de análise pela posição (FEN).
