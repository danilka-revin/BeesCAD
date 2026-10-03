// Универсальный индикатор загрузки / прогресса выполнения операции.
// Если value не задан (или < 0) — показывает бегущую полосу (indeterminate).

export function ProgressBar({
  value,
  label,
  detail,
  size = 'md',
}: {
  value?: number | null;
  label?: string;
  detail?: string;
  size?: 'sm' | 'md';
}) {
  const determinate = typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const pct = determinate ? Math.max(0, Math.min(100, Math.round(value!))) : 0;
  return (
    <div
      className={`progress-wrap progress-${size}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? pct : undefined}
      aria-label={label || 'Загрузка'}
    >
      {(label || determinate) && (
        <div className="progress-head">
          {label && <span className="progress-label">{label}</span>}
          {determinate && <span className="progress-pct mono">{pct}%</span>}
        </div>
      )}
      <div className={'progress-track' + (determinate ? '' : ' indeterminate')}>
        <div className="progress-fill" style={determinate ? { width: `${pct}%` } : undefined} />
      </div>
      {detail && <div className="progress-detail">{detail}</div>}
    </div>
  );
}
