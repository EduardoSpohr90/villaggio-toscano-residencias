import { useMemo } from 'preact/hooks';
import type { CalEvent, Holiday } from '../../shared/types';
import { addDays, today, formatLong, formatShort, WEEKDAYS, weekday, formatDayMonth } from '../../shared/dates.js';
import { groupByDay } from '../../shared/layout.js';
import { EventRow, HolidayLine, useUi } from './common';

interface Props {
  events: CalEvent[];
  overdue: CalEvent[];
  holidays: Map<string, Holiday[]>;
  days: number;
}

function relLabel(date: string, t: string) {
  if (date === t) return 'Hoje';
  if (date === addDays(t, 1)) return 'Amanhã';
  return null;
}

export function AgendaView({ events, overdue, holidays, days }: Props) {
  const ui = useUi();
  const t = today();
  const byDay = useMemo(() => groupByDay(events), [events]);
  const list: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(t, i);
    const hol = (holidays.get(d) || []).filter((h) => h.kind !== 'comemorativa');
    if (i < 2 || (byDay.get(d) || []).length || hol.length) list.push(d);
  }
  const empty = !events.length && !overdue.length;
  return (
    <section aria-label="Agenda">
      {overdue.length ? (
        <div class="day-group">
          <h2 class="section-title">Tarefas pendentes</h2>
          <ul class="list card">
            {overdue.map((ev) => (
              <EventRow ev={ev} showDate={formatShort(ev.start.slice(0, 10))} />
            ))}
          </ul>
        </div>
      ) : null}
      {list.map((d) => {
        const items = byDay.get(d) || [];
        const rel = relLabel(d, t);
        return (
          <div class="day-group" data-date={d}>
            <h2 class="day-head">
              <span class="rel">{rel || formatLong(d)}</span>
              {rel ? <span class="date">{WEEKDAYS[weekday(d)]}, {formatDayMonth(d)}</span> : null}
            </h2>
            {(holidays.get(d) || []).map((h) => (
              <HolidayLine h={h} />
            ))}
            {items.length ? (
              <ul class="list card">
                {items.map((ev) => (
                  <EventRow ev={ev} />
                ))}
              </ul>
            ) : (
              <div class="card empty" style={{ padding: '14px 16px', textAlign: 'left' }}>
                Nada marcado.
              </div>
            )}
          </div>
        );
      })}
      {empty ? (
        <div class="empty">
          Nada marcado nos próximos {days} dias.
          <div>
            <button type="button" class="btn primary" onClick={() => ui.openNew()}>
              Novo compromisso
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
