import { createContext } from 'preact';
import { useContext, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { CalEvent, Category, Holiday, Person } from '../../shared/types';
import { CATEGORY_LABELS } from '../../shared/model.js';
import { formatRange } from '../../shared/dates.js';
import { engine, type EngineState } from '../services/engine';
import { CategoryIcon, IconCheck } from './Icons';

/**
 * Re-renderiza quando o motor muda. A assinatura é síncrona e compara a
 * versão vista na renderização: uma resposta de rede que chegue antes da
 * assinatura nunca deixa a tela desatualizada.
 */
export function useEngine(): EngineState {
  const [, force] = useState(0);
  const seen = useRef(engine.state.version);
  seen.current = engine.state.version;
  useLayoutEffect(() => {
    const unsubscribe = engine.subscribe(() => force((n) => n + 1));
    if (engine.state.version !== seen.current) force((n) => n + 1);
    return unsubscribe;
  }, []);
  return engine.state;
}

export interface UiActions {
  openEvent: (ev: CalEvent) => void;
  openNew: (preset?: { date?: string; time?: string }, trigger?: Element | null) => void;
  openHoliday: (h: Holiday) => void;
  labels: Record<Person, string>;
  conflictIds: Set<string>;
}
export const Ui = createContext<UiActions>(null as unknown as UiActions);
export const useUi = () => useContext(Ui);

/** Iniciais únicas: Eduardo e Esposa começam com E → 'Ed' e 'Es'. */
export function initialsFor(person: Person, labels: Record<Person, string>) {
  const first = (s: string) => s.trim().charAt(0).toUpperCase();
  const mine = labels[person] || person;
  const clash = (Object.keys(labels) as Person[]).some((p) => p !== person && first(labels[p]) === first(mine));
  return clash ? mine.trim().slice(0, 2).replace(/^./, (c) => c.toUpperCase()) : first(mine);
}

export function Avatar({ person, small }: { person: Person; small?: boolean }) {
  const { labels } = useUi();
  return (
    <span class={`avatar${small ? ' sm' : ''}`} data-owner={person} aria-hidden="true">
      {initialsFor(person, labels)}
    </span>
  );
}

export function CategoryBadge({ category }: { category: Category }) {
  return (
    <span class="cat">
      <CategoryIcon category={category} />
      {CATEGORY_LABELS[category]}
    </span>
  );
}

/** Rótulo acessível: quem + o quê + quando. */
export function describeEvent(ev: CalEvent, labels: Record<Person, string>) {
  const kind = ev.kind === 'task' ? (ev.taskStatus === 'done' ? 'Tarefa concluída' : 'Tarefa') : 'Compromisso';
  return `${kind}: ${ev.title}. ${labels[ev.owner]}, ${CATEGORY_LABELS[ev.category]}, ${formatRange(ev)}.`;
}

export function TaskCheck({ ev }: { ev: CalEvent }) {
  const done = ev.taskStatus === 'done';
  return (
    <button
      type="button"
      class="check"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `Marcar “${ev.title}” como pendente` : `Concluir “${ev.title}”`}
      data-owner={ev.owner}
      onClick={() => engine.toggleTask(ev)}
    >
      <span>{done ? <IconCheck /> : null}</span>
    </button>
  );
}

export function EventRow({ ev, showDate }: { ev: CalEvent; showDate?: string }) {
  const ui = useUi();
  const done = ev.kind === 'task' && ev.taskStatus === 'done';
  const conflict = ui.conflictIds.has(ev.id);
  return (
    <li class="li-wrap" data-owner={ev.owner}>
      <button
        type="button"
        class={`row${done ? ' done' : ''}`}
        onClick={() => ui.openEvent(ev)}
        aria-label={describeEvent(ev, ui.labels)}
      >
        <Avatar person={ev.owner} />
        <div class="row-main">
          <div class="row-title">{ev.title}</div>
          <div class="row-meta">
            <span class="row-time">{showDate ? `${showDate} · ` : ''}{formatRange(ev)}</span>
            <CategoryBadge category={ev.category} />
            {ev.location ? <span>{ev.location}</span> : null}
            {conflict ? <span class="conflict-mark">Conflito</span> : null}
            {ev.pending ? <span class="pending-mark">↻ a sincronizar</span> : null}
          </div>
        </div>
      </button>
      {ev.kind === 'task' ? <TaskCheck ev={ev} /> : null}
    </li>
  );
}

export function HolidayLine({ h }: { h: Holiday }) {
  const { openHoliday } = useUi();
  const soft = h.kind !== 'feriado';
  const label = h.kind === 'facultativo' ? `${h.name} · ponto facultativo` : h.kind === 'comemorativa' ? h.name : `${h.name} · feriado`;
  return (
    <button type="button" class={`holiday-line${soft ? ' soft' : ''}`} onClick={() => openHoliday(h)}>
      {label}
    </button>
  );
}
