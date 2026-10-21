import { BOARD_THEMES, type BoardThemeKey } from './BoardView';
import { VOICE_LANGS, type Settings } from '../lib/settings';
import { speechSynthesisSupported } from '../lib/voice/speech';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

export function SettingsPanel({ settings, onChange }: Props) {
  const toggle = (key: keyof Settings, label: string, hint?: string) => (
    <label className="switch row-switch" title={hint}>
      <input type="checkbox" checked={Boolean(settings[key])} onChange={(e) => onChange({ [key]: e.target.checked } as Partial<Settings>)} />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="panel-section">
      <h3>Voz</h3>
      <label className="field">
        <span>Idioma do reconhecimento</span>
        <select value={settings.voiceLang} onChange={(e) => onChange({ voiceLang: e.target.value })}>
          {VOICE_LANGS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      {toggle('speakMoves', 'Falar os lances do Stockfish', speechSynthesisSupported() ? undefined : 'Síntese de voz indisponível')}

      <h3>Tabuleiro</h3>
      <div className="theme-picker">
        {(Object.keys(BOARD_THEMES) as BoardThemeKey[]).map((k) => (
          <button
            key={k}
            className={`theme-swatch ${settings.theme === k ? 'active' : ''}`}
            onClick={() => onChange({ theme: k })}
            title={BOARD_THEMES[k].name}
            aria-label={`Tema ${BOARD_THEMES[k].name}`}
          >
            <span style={{ background: BOARD_THEMES[k].light }} />
            <span style={{ background: BOARD_THEMES[k].dark }} />
          </button>
        ))}
      </div>
      {toggle('showLegal', 'Mostrar lances legais')}
      {toggle('animate', 'Animações')}
      {toggle('sounds', 'Sons')}

      <h3>Análise</h3>
      {toggle('showEval', 'Barra de avaliação (Stockfish força máxima)', 'No modo revisão a avaliação é sempre exibida')}
      <p className="muted small">
        A avaliação usa um segundo Stockfish em força total, independente do adversário. Ative com cuidado se quiser jogar “às cegas”.
      </p>
    </div>
  );
}

export function HelpPanel() {
  const rows: Array<[string, string]> = [
    ['“e quatro”, “peão e4”', 'Peão para e4'],
    ['“cavalo efe três”, “Nf3”', 'Cavalo para f3'],
    ['“bispo toma cê seis”', 'Captura com o bispo em c6'],
    ['“e toma dê cinco”', 'Peão da coluna e captura em d5'],
    ['“e dois para e quatro”', 'Origem e destino (e2 → e4)'],
    ['“cavalo bê d dois” / “cavalo b1 d2”', 'Desambiguar entre dois cavalos'],
    ['“roque curto” / “roque longo”', 'Roque pequeno / grande'],
    ['“e oito dama”, “promove para cavalo”', 'Promoção (padrão: dama)'],
    ['“desfazer”', 'Volta o seu último lance'],
    ['“dica”', 'Stockfish sugere o melhor lance'],
    ['“girar tabuleiro”', 'Inverte a orientação'],
    ['“oferecer empate”', 'Propõe empate ao Stockfish'],
    ['“desistir”, “nova partida”', 'Pede confirmação (“sim” / “cancelar”)'],
    ['“repetir”', 'Repete o último lance em voz alta'],
  ];
  return (
    <div className="panel-section">
      <h3>Comandos de voz</h3>
      <p className="muted small">
        Colunas: a, bê, cê, dê, é, efe, gê, agá. Números: um a oito. Funciona em português e inglês. Se a frase for ambígua, o
        app mostra as opções.
      </p>
      <table className="help-table">
        <tbody>
          {rows.map(([say, does]) => (
            <tr key={say}>
              <td>
                <code>{say}</code>
              </td>
              <td>{does}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Atalhos</h3>
      <ul className="small">
        <li>
          <kbd>Espaço</kbd> liga/desliga o microfone
        </li>
        <li>
          <kbd>←</kbd> <kbd>→</kbd> navegam pelos lances
        </li>
        <li>
          <kbd>F</kbd> gira o tabuleiro
        </li>
      </ul>
      <p className="muted small">
        Dica: o reconhecimento de voz funciona melhor no Chrome/Edge (usa serviço online). No Firefox, use o campo de texto.
      </p>
    </div>
  );
}
