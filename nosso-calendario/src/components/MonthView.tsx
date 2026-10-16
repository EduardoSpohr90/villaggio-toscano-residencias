import { useMemo } from 'preact/hooks';
import type { CalEvent, Holiday } from '../../shared/types';
import {
  addDays, startOfMonth, startOfWeek, today, WEEK_HEADER, formatLong, timeOf, formatDayMonth,
} from '../../shared/dates.js';
import { groupByDay } from '../../shared/layout.js';
import { CategoryIcon } from './Icons';
import { EventRow, HolidayLine, useUi, describeEvent } from './common';

interface Props {
  cursor: string;
  selected: string;
  events: CalEvent[];
  holidays: Map<string, Holiday[]>;
  onSelect: (date: string) => void;
}

const MAX_CHIPS = 3;

function wide() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(min-width: 600px)').matches;
}

export function MonthView({ cursor, selected, events, holidays, onSelect }: Props) {
  const ui = useUi();
  const first = startOfMonth(cursor);
  const gridStart = startOfWeek(first);
  const month = first.slice(0, 7);
  const t = today();
  const byDay = useMemo(() => groupByDay(events), [events]);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  // Remove a última semana quando ela é inteira do mês seguinte.
  const visible = days.slice(35).every((d) => d.slice(0, 7) !== month) ? days.slice(0, 35) : days;

  const tap = (date: string) => {
    const list = byDay.get(date) || [];
    if (date === selected || !list.length) {
      onSelect(date);
      ui.openNew({ date });
      return;
    }
    onSelect(date);
  };

  const selectedList = byDay.get(selected) || [];
  const selectedHolidays = holidays.get(selected) || [];

  return (
    <section class="month" aria-label="Mês">
      <div class="month-head" aria-hidden="true">
        {WEEK_HEADER.map((d) => (
          <div>{d}</div>
        ))}
      </div>
      <div class="month-grid">
        {visible.map((date) => {
          const list = byDay.get(date) || [];
          const hol = (holidays.get(date) || []).filter((h) => h.kind !== 'comemorativa');
          const n = Number(date.slice(8, 10));
          const cls = [
            'm-cell',
            date.slice(0, 7) !== month ? 'out' : '',
            date === t ? 'today' : '',
            date === selected ? 'selected' : '',
            hol.length ? 'holiday' : '',
          ].join(' ');
          const more = list.length - MAX_CHIPS;
          const label = `${formatDayMonth(date)}${hol.length ? `, ${hol[0].name}` : ''}, ${list.length ? `${list.length} item(ns)` : 'livre'}`;
          return (
            <div class={cls} data-date={date} onClick={() => tap(date)}>
              <button
                type="button"
                class="m-num"
                aria-label={label}
                aria-pressed={date === selected}
                onClick={(e) => {
                  e.stopPropagation();
                  tap(date);
                }}
              >
                {n}
              </button>
              {hol.length && list.length < MAX_CHIPS ? (
                <span class="m-chip holiday" aria-hidden="true">
                  <span class="n">{hol[0].name}</span>
                </span>
              ) : null}
              {list.slice(0, MAX_CHIPS).map((ev) => (
                <button
                  type="button"
                  class={`m-chip${ev.kind === 'task' && ev.taskStatus === 'done' ? ' done' : ''}`}
                  data-owner={ev.owner}
                  aria-label={describeEvent(ev, ui.labels)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (wide()) ui.openEvent(ev);
                    else tap(date);
                  }}
                >
                  {!ev.allDay ? <span class="t">{timeOf(ev.start)}</span> : null}
                  <CategoryIcon category={ev.category} />
                  <span class="n">{ev.title}</span>
                </button>
              ))}
              {more > 0 ? <span class="m-more">+{more}</span> : null}
            </div>
          );
        })}
      </div>

      <div class="month-day" data-testid="day-panel">
        <div class="day-head">
          <span class="rel">{formatLong(selected)}</span>
        </div>
        {selectedHolidays.map((h) => (
          <HolidayLine h={h} />
        ))}
        {selectedList.length ? (
          <ul class="list card">
            {selectedList.map((ev) => (
              <EventRow ev={ev} />
            ))}
          </ul>
        ) : (
          <div class="card empty">
            Nada marcado.
            <div>
              <button type="button" class="btn" onClick={() => ui.openNew({ date: selected })}>
                Novo neste dia
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
