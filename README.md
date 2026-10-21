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
