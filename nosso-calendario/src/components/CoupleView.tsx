import { useMemo } from 'preact/hooks';
import type { BusyBlock, CalEvent, Holiday, Person } from '../../shared/types';
import { addDays, msToWall, formatShort, formatLong, today, nowWall, wallToMs } from '../../shared/dates.js';
import { detectConflicts, freeTogether } from '../../shared/conflicts.js';
import { groupByDay } from '../../shared/layout.js';
import { EventRow, HolidayLine, useUi } from './common';

interface Props {
  weekStart: string;
  events: CalEvent[];
  busy: BusyBlock[];
  holidays: Map<string, Holiday[]>;
}

const range = (s: number, e: number) => `${msToWall(s).slice(11, 16)}–${msToWall(e).slice(11, 16)}`;

export function CoupleView({ weekStart, events, busy, holidays }: Props) {
  const ui = useUi();
  const t = today();
  const data = useMemo(() => {
    const busyItems = busy.map((b) => ({ ...b, allDay: false, title: 'Ocupado', busy: true }));
    const conflicts = detectConflicts([...events, ...busyItems] as any);
    const holidaySet = new Set<string>();
    for (const [d, hs] of holidays) if (hs.some((h) => h.kind === 'feriado')) holidaySet.add(d);
    const free = freeTogether([...events, ...busyItems] as any, weekStart, 7, {
      minMinutes: 120,
      holidays: holidaySet,
      now: wallToMs(nowWall()),
    })
      .filter((f) => f.date >= t)
      .slice(0, 6);
    const count = (p: Person) => events.filter((e) => e.owner === p && e.kind === 'event').length;
    const pendingTasks = events.filter((e) => e.kind === 'task' && e.taskStatus !== 'done');
    return { conflicts, free, count, pendingTasks };
  }, [weekStart, events, busy, holidays]);
  const byDay = useMemo(() => groupByDay(events.filter((e) => e.kind === 'event')), [events]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <section aria-label="Semana do casal">
      <div class="summary" role="list">
        {(['eduardo', 'esposa', 'casal'] as Person[]).map((p) => (
          <div class="stat" data-owner={p} role="listitem">
            <b>{data.count(p)}</b>
            <span>
              <i class="swatch" aria-hidden="true" />
              {ui.labels[p]}
            </span>
          </div>
        ))}
        <div class="stat" role="listitem">
          <b>{data.pendingTasks.length}</b>
          <span>Tarefas pendentes</span>
        </div>
        <div class="stat" role="listitem">
          <b style={data.conflicts.length ? { color: 'var(--warn)' } : undefined}>{data.conflicts.length}</b>
          <span>Conflitos</span>
        </div>
        <div class="stat" role="listitem">
          <b>{data.free.length}</b>
          <span>Livres juntos</span>
        </div>
      </div>

      {data.conflicts.length ? (
        <>
          <h2 class="section-title">Conflitos</h2>
          {data.conflicts.map((c) => {
            const a: any = c.a;
            const b: any = c.b;
            const line = (x: any) => `${ui.labels[x.owner as Person]} — ${x.busy ? 'Ocupado' : x.title}`;
            return (
              <div class="card conflict-card" data-testid="conflict-card">
                <h4>
                  Conflito · {formatShort(msToWall(c.start).slice(0, 10))} · <span class="tnum">{range(c.start, c.end)}</span>
                </h4>
                <p>{line(a)}</p>
                <p>{line(b)}</p>
                <small>{c.type === 'mesma-pessoa' ? 'A mesma pessoa em dois compromissos.' : 'Os dois ocupados ao mesmo tempo.'}</small>
              </div>
            );
          })}
        </>
      ) : null}

      <h2 class="section-title">Livres juntos</h2>
      {data.free.length ? (
        <ul class="free-list card">
          {data.free.map((f) => (
            <li>
              <span>{formatShort(f.date)}</span>
              <span>{range(f.start, f.end)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div class="card empty">Sem janelas de 2 horas livres para os dois nesta semana.</div>
      )}

      {data.pendingTasks.length ? (
        <>
          <h2 class="section-title">Tarefas pendentes</h2>
          <ul class="list card">
            {data.pendingTasks.map((ev) => (
              <EventRow ev={ev} showDate={formatShort(ev.start.slice(0, 10))} />
            ))}
          </ul>
        </>
      ) : null}

      <h2 class="section-title">Dia a dia</h2>
      {days.map((d) => {
        const items = byDay.get(d) || [];
        const hol = holidays.get(d) || [];
        if (!items.length && !hol.length) return null;
        return (
          <div class="day-group">
            <h3 class="day-head">
              <span class="rel">{d === t ? 'Hoje' : formatLong(d)}</span>
            </h3>
            {hol.map((h) => (
              <HolidayLine h={h} />
            ))}
            {items.length ? (
              <ul class="list card">
                {items.map((ev) => (
                  <EventRow ev={ev} />
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
      {!events.length ? <div class="empty">Semana livre até agora.</div> : null}
    </section>
  );
}
