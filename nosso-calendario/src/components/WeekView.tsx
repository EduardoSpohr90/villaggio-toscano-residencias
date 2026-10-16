import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { BusyBlock, CalEvent, Holiday } from '../../shared/types';
import { addDays, today, nowWall, timeToMin, minToTime, WEEKDAYS_SHORT, weekday, timeOf, formatRange } from '../../shared/dates.js';
import { segmentForDay, packColumns, GRID_START_MIN, GRID_END_MIN, compareEvents } from '../../shared/layout.js';
import { CategoryIcon } from './Icons';
import { useUi, describeEvent } from './common';

interface Props {
  weekStart: string;
  events: CalEvent[];
  busy: BusyBlock[];
  holidays: Map<string, Holiday[]>;
}

const HOUR_PX = 48;
const PX = HOUR_PX / 60;

type Block = { key: string; top: number; height: number; ev?: CalEvent; busy?: BusyBlock; clippedTop: boolean };

export function WeekView({ weekStart, events, busy, holidays }: Props) {
  const ui = useUi();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const t = today();
  const scroller = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(nowWall());

  useEffect(() => {
    const id = setInterval(() => setNow(nowWall()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Rola para perto do horário atual (ou 07:00) ao abrir a semana.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const inWeek = days.includes(t);
    const min = inWeek ? timeToMin(now.slice(11, 16)) - 90 : 7 * 60;
    el.scrollTop = Math.max(0, (Math.max(min, GRID_START_MIN) - GRID_START_MIN) * PX);
    // No celular a semana rola na horizontal: começa no dia de hoje.
    const idx = days.indexOf(t);
    const col = el.querySelector<HTMLElement>('.w-col');
    el.scrollLeft = idx > 0 && col ? Math.max(0, (idx - 1) * col.offsetWidth) : 0;
  }, [weekStart]);

  const columns = useMemo(
    () =>
      days.map((date) => {
        const blocks: Block[] = [];
        for (const ev of events) {
          const seg = segmentForDay(ev, date);
          if (seg) blocks.push({ key: ev.id, top: seg.top, height: seg.height, ev, clippedTop: seg.clippedTop });
        }
        for (const b of busy) {
          const seg = segmentForDay({ ...b, allDay: false }, date);
          if (seg) blocks.push({ key: b.id, top: seg.top, height: seg.height, busy: b, clippedTop: seg.clippedTop });
        }
        return { date, placed: packColumns(blocks) };
      }),
    [weekStart, events, busy],
  );

  const allDay = days.map((date) => ({
    date,
    hol: (holidays.get(date) || []).filter((h) => h.kind !== 'comemorativa'),
    list: events.filter((e) => e.allDay && e.start <= date && e.end > date).sort(compareEvents),
  }));
  const hasAllDay = allDay.some((d) => d.hol.length || d.list.length);

  const hours = [];
  for (let m = GRID_START_MIN; m <= GRID_END_MIN; m += 60) hours.push(m);

  const onColumnTap = (date: string, e: MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const min = Math.floor((y / PX + GRID_START_MIN) / 30) * 30;
    ui.openNew({ date, time: minToTime(Math.min(Math.max(min, GRID_START_MIN), GRID_END_MIN - 60)) });
  };

  return (
    <section class="week" aria-label="Semana">
      <div class="week-scroll" ref={scroller} data-testid="week-grid">
        <div class="week-inner">
        <div class="week-head">
          <div class="week-corner" />
          {days.map((date) => {
            const hol = (holidays.get(date) || []).some((h) => h.kind === 'feriado');
            return (
              <div class={`wh-day${date === t ? ' today' : ''}${hol ? ' holiday' : ''}`}>
                {WEEKDAYS_SHORT[weekday(date)]}
                <b>{Number(date.slice(8, 10))}</b>
              </div>
            );
          })}
        </div>
        {hasAllDay ? (
          <div class="week-allday">
            <div class="wa-label">dia</div>
            {allDay.map((d) => (
              <div class="wa-day">
                {d.hol.map((h) => (
                  <button type="button" class="mini-chip holiday" onClick={() => ui.openHoliday(h)}>
                    {h.name}
                  </button>
                ))}
                {d.list.map((ev) => (
                  <button type="button" class="mini-chip" data-owner={ev.owner} aria-label={describeEvent(ev, ui.labels)} onClick={() => ui.openEvent(ev)}>
                    {ev.title}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : null}
        <div class="week-body" style={{ height: `${(GRID_END_MIN - GRID_START_MIN) * PX + 12}px` }}>
          <div class="w-hours" aria-hidden="true">
            {hours.map((m) => (
              <span style={{ top: `${(m - GRID_START_MIN) * PX}px` }}>{m === GRID_START_MIN ? '' : minToTime(m)}</span>
            ))}
          </div>
          {columns.map(({ date, placed }) => (
            <div
              class={`w-col${date === t ? ' today' : ''}`}
              onClick={(e) => onColumnTap(date, e as unknown as MouseEvent)}
              data-date={date}
            >
              {placed.map((b) => {
                const style = {
                  top: `${b.top * PX}px`,
                  height: `${Math.max(b.height * PX - 2, 16)}px`,
                  left: `calc(${(b.col / b.cols) * 100}% + 1px)`,
                  width: `calc(${100 / b.cols}% - 2px)`,
                };
                if (b.busy) {
                  return (
                    <div class="w-ev busy" data-owner={b.busy.owner} style={style} aria-label={`${ui.labels[b.busy.owner]}: ocupado ${timeOf(b.busy.start)}–${timeOf(b.busy.end)}`} onClick={(e) => e.stopPropagation()}>
                      <span class="n">Ocupado</span>
                      <span class="t">{ui.labels[b.busy.owner]}</span>
                    </div>
                  );
                }
                const ev = b.ev!;
                const done = ev.kind === 'task' && ev.taskStatus === 'done';
                const conflict = ui.conflictIds.has(ev.id);
                return (
                  <button
                    type="button"
                    class={`w-ev${conflict ? ' conflict' : ''}${done ? ' done' : ''}${b.clippedTop ? ' clip-top' : ''}`}
                    data-owner={ev.owner}
                    style={style}
                    aria-label={describeEvent(ev, ui.labels) + (conflict ? ' Conflito de horário.' : '')}
                    onClick={(e) => {
                      e.stopPropagation();
                      ui.openEvent(ev);
                    }}
                  >
                    <span class="n">{ev.title}</span>
                    {b.height >= 40 ? <span class="t">{formatRange(ev)}</span> : null}
                    {b.height >= 55 ? <CategoryIcon category={ev.category} /> : null}
                  </button>
                );
              })}
              {date === t && timeToMin(now.slice(11, 16)) >= GRID_START_MIN && timeToMin(now.slice(11, 16)) <= GRID_END_MIN ? (
                <div class="w-now" style={{ top: `${(timeToMin(now.slice(11, 16)) - GRID_START_MIN) * PX}px` }} aria-hidden="true" />
              ) : null}
            </div>
          ))}
        </div>
        </div>
      </div>
    </section>
  );
}
