import { evalLabel, evalPercent, type Color, type Evaluation } from '../lib/game';

interface Props {
  evaluation: Evaluation | null;
  orientation: Color;
}

export function EvalBar({ evaluation, orientation }: Props) {
  const pct = evalPercent(evaluation); // % favorável às brancas
  const whiteOnBottom = orientation === 'white';
  const label = evalLabel(evaluation);
  const whiteAhead = (evaluation?.cp ?? evaluation?.mate ?? 0) >= 0;
  return (
    <div className="eval-bar" title={`Avaliação: ${label}`} data-bottom={whiteOnBottom ? 'white' : 'black'}>
      <div className="eval-white" style={{ height: `${pct}%`, [whiteOnBottom ? 'bottom' : 'top']: 0 }} />
      <span className={`eval-label ${whiteAhead ? 'on-white' : 'on-black'}`} style={whiteAhead === whiteOnBottom ? { bottom: 4 } : { top: 4 }}>
        {label}
      </span>
    </div>
  );
}
