import { useMemo } from 'preact/hooks';
import type { CalEvent, Holiday } from '../../shared/types';
import { addDays, daysInMonth, makeDate, today, MONTHS, WEEK_HEADER, formatDayMonth } from '../../shared/dates.js';
import { groupByDay } from '../../shared/layout.js';

interface Props {
  year: number;
  events: CalEvent[];
  holidays: Map<string, Holiday[]>;
  onDay: (date: string) => void;
  onMonth: (date: string) => void;
}

function load(n: number) {
  return n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3;
}

export function YearView({ year, events, holidays, onDay, onMonth }: Props) {
  const t = today();
  const byDay = useMemo(() => groupByDay(events), [events]);
  return (
    <section aria-label={`Ano ${year}`}>
      <div class="year">
        {MONTHS.map((name, i) => {
          const m = i + 1;
          const first = makeDate(year, m, 1);
          const lead = (new Date(Date.UTC(year, i, 1)).getUTCDay() + 6) % 7;
          const total = daysInMonth(year, m);
          const isCurrent = t.slice(0, 7) === first.slice(0, 7);
          return (
            <div class="y-month">
              <button type="button" class={`y-title${isCurrent ? ' current' : ''}`} onClick={() => onMonth(first)}>
                {name}
              </button>
              <div class="y-head" aria-hidden="true">
                {WEEK_HEADER.map((d) => (
                  <span>{d}</span>
                ))}
              </div>
              <div class="y-grid">
                {Array.from({ length: lead }, () => (
                  <span />
                ))}
                {Array.from({ length: total }, (_, k) => {
                  const date = addDays(first, k);
                  const n = (byDay.get(date) || []).length;
                  const hol = (holidays.get(date) || []).filter((h) => h.kind === 'feriado');
                  const cls = `y-day${date === t ? ' today' : ''}${hol.length ? ' holiday' : ''}`;
                  const label = `${formatDayMonth(date)}${hol.length ? `, ${hol[0].name}` : ''}${n ? `, ${n} item(ns)` : ''}`;
                  return (
                    <button type="button" class={cls} data-load={load(n)} aria-label={label} onClick={() => onDay(date)}>
                      {k + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div class="y-legend" aria-hidden="true">
        <span><i style={{ background: 'rgba(127,127,132,.26)' }} />dias com compromissos (mais escuro = mais cheio)</span>
        <span><i style={{ background: 'var(--holiday)' }} />feriado</span>
      </div>
    </section>
  );
}
