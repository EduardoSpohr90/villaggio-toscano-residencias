import { useMemo, useState } from 'preact/hooks';
import type { CalEvent, Category, EventInput, Kind, Person, Reminder } from '../../shared/types';
import {
  CATEGORIES, CATEGORY_LABELS, PEOPLE, REMINDERS, REMINDER_LABELS, validateEventInput, LIMITS,
} from '../../shared/model.js';
import {
  addDays, diffDays, timeToMin, minToTime, formatRange, nowWall, today, weekday,
} from '../../shared/dates.js';
import {
  BYDAY, BYDAY_LABELS, buildRRule, describeRRule, parseRRule, presetOf, untilFromDate, untilToDate,
} from '../../shared/recurrence.js';
import { conflictsFor } from '../../shared/conflicts.js';
import { engine } from '../services/engine';
import type { Scope } from '../services/local-store';
import { readJSON, writeJSON, KEYS } from '../services/storage';
import { Sheet } from './Sheet';
import { CategoryIcon } from './Icons';
import { useUi } from './common';

type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
type EndType = 'never' | 'until' | 'count';

interface Form {
  kind: Kind;
  title: string;
  owner: Person;
  category: Category;
  date: string;
  endDate: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
  repeat: Repeat;
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  byDay: string[];
  endType: EndType;
  until: string;
  count: number;
  reminder: Reminder;
  taskStatus: 'pending' | 'done';
}

const WD_TO_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function nextSlot() {
  // Próxima hora cheia (ou meia hora) a partir de agora, em SP.
  const now = nowWall();
  const min = timeToMin(now.slice(11, 16));
  const slot = Math.min(Math.ceil((min + 1) / 30) * 30, 22 * 60 + 30);
  return minToTime(slot);
}

function formFromEvent(ev: CalEvent): Form {
  const rule = parseRRule(ev.rrule || '');
  const allDay = ev.allDay;
  return {
    kind: ev.kind,
    title: ev.title,
    owner: ev.owner,
    category: ev.category,
    date: ev.start.slice(0, 10),
    endDate: allDay ? addDays(ev.end, -1) : ev.end.slice(0, 10),
    allDay,
    startTime: allDay ? '09:00' : ev.start.slice(11, 16),
    endTime: allDay ? '10:00' : ev.end.slice(11, 16),
    location: ev.location || '',
    notes: ev.notes || '',
    repeat: presetOf(ev.rrule || '') as Repeat,
    freq: rule ? rule.freq : 'WEEKLY',
    interval: rule ? rule.interval : 1,
    byDay: rule && rule.byDay.length ? rule.byDay : [WD_TO_BYDAY[weekday(ev.start.slice(0, 10))]],
    endType: rule && rule.count ? 'count' : rule && rule.until ? 'until' : 'never',
    until: rule && rule.until ? untilToDate(rule.until) : addDays(ev.start.slice(0, 10), 90),
    count: rule && rule.count ? rule.count : 10,
    reminder: ev.reminder || 'none',
    taskStatus: ev.taskStatus === 'done' ? 'done' : 'pending',
  };
}

function newForm(preset: { date?: string; time?: string } = {}, owner: Person): Form {
  const prefs = readJSON<{ lastCategory?: Category }>(KEYS.prefs, {});
  const date = preset.date || today();
  const startTime = preset.time || nextSlot();
  return {
    kind: 'event',
    title: '',
    owner,
    category: prefs.lastCategory && CATEGORIES.includes(prefs.lastCategory) ? prefs.lastCategory : 'familia',
    date,
    endDate: date,
    allDay: false,
    startTime,
    endTime: minToTime(Math.min(timeToMin(startTime) + 60, 23 * 60 + 59)),
    location: '',
    notes: '',
    repeat: 'none',
    freq: 'WEEKLY',
    interval: 1,
    byDay: [WD_TO_BYDAY[weekday(date)]],
    endType: 'never',
    until: addDays(date, 90),
    count: 10,
    reminder: '10',
    taskStatus: 'pending',
  };
}

function ruleOf(f: Form): string | undefined {
  switch (f.repeat) {
    case 'none':
      return undefined;
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekly':
      return 'FREQ=WEEKLY';
    case 'monthly':
      return 'FREQ=MONTHLY';
    case 'yearly':
      return 'FREQ=YEARLY';
    default:
      return buildRRule({
        freq: f.freq,
        interval: Math.max(1, Math.min(99, Math.floor(f.interval) || 1)),
        byDay: f.freq === 'WEEKLY' ? f.byDay : [],
        count: f.endType === 'count' ? Math.max(1, Math.min(999, Math.floor(f.count) || 1)) : undefined,
        until: f.endType === 'until' && f.until ? untilFromDate(f.until, f.allDay) : undefined,
      });
  }
}

function toInput(f: Form): { input?: EventInput; error?: string } {
  let start: string;
  let end: string;
  if (f.allDay) {
    const last = f.endDate && f.endDate >= f.date ? f.endDate : f.date;
    start = f.date;
    end = addDays(last, 1);
  } else {
    start = `${f.date}T${f.startTime}`;
    end = `${f.date}T${f.endTime}`;
    if (f.endTime <= f.startTime) return { error: 'O término precisa ser depois do início.' };
  }
  const v = validateEventInput({
    title: f.title,
    owner: f.owner,
    category: f.category,
    kind: f.kind,
    taskStatus: f.taskStatus,
    allDay: f.allDay,
    start,
    end,
    location: f.location,
    notes: f.notes,
    reminder: f.reminder,
    rrule: ruleOf(f),
  });
  if (!v.ok) return { error: v.error };
  return { input: v.value as EventInput };
}

interface Props {
  event?: CalEvent;
  preset?: { date?: string; time?: string };
  onClose: () => void;
}

export function EventSheet({ event, preset, onClose }: Props) {
  const ui = useUi();
  const me = engine.state.me;
  const defaultOwner: Person = (me && me.person) || 'casal';
  const [f, setF] = useState<Form>(() => (event ? formFromEvent(event) : newForm(preset, defaultOwner)));
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<null | 'save' | 'delete'>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const recurring = !!(event && event.seriesId);
  const set = (patch: Partial<Form>) => {
    setError('');
    setF((prev) => ({ ...prev, ...patch }));
  };

  const candidate = useMemo(() => toInput(f).input, [f]);
  const conflicts = useMemo(() => {
    if (!candidate || candidate.allDay) return [];
    const from = candidate.start.slice(0, 10);
    const others = [
      ...engine.eventsInRange(from, addDays(from, 2)),
      ...engine.busyInRange(from, addDays(from, 2)).map((b) => ({ ...b, allDay: false, title: 'Ocupado', busy: true })),
    ];
    return conflictsFor({ ...candidate, id: event ? event.id : '__new__' }, others as any).slice(0, 3);
  }, [candidate, event]);

  const onStartTime = (v: string) => {
    if (!v) return set({ startTime: v });
    const dur = Math.max(15, timeToMin(f.endTime) - timeToMin(f.startTime));
    set({ startTime: v, endTime: minToTime(Math.min(timeToMin(v) + dur, 23 * 60 + 59)) });
  };

  const persist = async (scope: Scope) => {
    const { input, error: err } = toInput(f);
    if (!input) return setError(err || 'Revise os campos.');
    writeJSON(KEYS.prefs, { ...readJSON(KEYS.prefs, {}), lastCategory: input.category });
    if (event) await engine.update(event, input, scope);
    else await engine.create(input);
    if (navigator.onLine !== false || engine.state.mode === 'local') {
      engine.notify(input.kind === 'task' ? 'Tarefa salva.' : 'Compromisso salvo.');
    }
    onClose();
  };

  const save = (e?: Event) => {
    if (e) e.preventDefault();
    const { error: err } = toInput(f);
    if (err) return setError(err);
    if (recurring) return setAsk('save');
    persist('this');
  };

  const doDelete = async (scope: Scope) => {
    if (!event) return;
    await engine.remove(event, scope);
    engine.notify('Excluído.');
    onClose();
  };

  const titleText = event ? (f.kind === 'task' ? 'Editar tarefa' : 'Editar') : f.kind === 'task' ? 'Nova tarefa' : 'Novo compromisso';
  const ruleText = ruleOf(f);

  return (
    <>
      <Sheet
        title={titleText}
        onClose={onClose}
        testId="event-sheet"
        initialFocus={event ? undefined : '.title-input'}
        left={<button type="button" class="text-btn" onClick={onClose}>Cancelar</button>}
        right={<button type="submit" form="event-form" class="text-btn save">Salvar</button>}
      >
        <form id="event-form" onSubmit={save} noValidate>
          <div class="field">
            <label for="f-title">Título</label>
            <input
              id="f-title"
              class="input title-input"
              type="text"
              value={f.title}
              maxLength={LIMITS.title}
              autocomplete="off"
              autocapitalize="sentences"
              enterkeyhint="done"
              placeholder={f.kind === 'task' ? 'Ex.: Pagar a escola' : 'Ex.: Dentista'}
              onInput={(e) => set({ title: (e.target as HTMLInputElement).value })}
              required
            />
          </div>

          <div class="field">
            <span class="field-label" id="lbl-kind">Tipo</span>
            <div class="seg" role="radiogroup" aria-labelledby="lbl-kind">
              {(['event', 'task'] as Kind[]).map((k) => (
                <button type="button" role="radio" aria-checked={f.kind === k} onClick={() => set({ kind: k })}>
                  {k === 'event' ? 'Compromisso' : 'Tarefa'}
                </button>
              ))}
            </div>
          </div>

          <div class="field">
            <span class="field-label" id="lbl-owner">Responsável</span>
            <div class="seg" role="radiogroup" aria-labelledby="lbl-owner">
              {(PEOPLE as Person[]).map((p) => (
                <button type="button" role="radio" aria-checked={f.owner === p} data-owner={p} onClick={() => set({ owner: p })}>
                  <span class="swatch" aria-hidden="true" />
                  {ui.labels[p]}
                </button>
              ))}
            </div>
          </div>

          <div class="field">
            <span class="field-label" id="lbl-cat">Categoria</span>
            <div class="cat-grid" role="radiogroup" aria-labelledby="lbl-cat">
              {(CATEGORIES as Category[]).map((c) => (
                <button type="button" class="cat-opt" role="radio" aria-checked={f.category === c} onClick={() => set({ category: c })}>
                  <CategoryIcon category={c} />
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          </div>

          {f.kind === 'task' ? (
            <div class="field">
              <span class="field-label" id="lbl-status">Status da tarefa</span>
              <div class="seg" role="radiogroup" aria-labelledby="lbl-status">
                {(['pending', 'done'] as const).map((s) => (
                  <button type="button" role="radio" aria-checked={f.taskStatus === s} onClick={() => set({ taskStatus: s })}>
                    {s === 'pending' ? 'Pendente' : 'Concluída'}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div class="switch-row">
            <label for="f-allday">Dia inteiro</label>
            <span class="switch">
              <input id="f-allday" type="checkbox" role="switch" checked={f.allDay} onChange={(e) => set({ allDay: (e.target as HTMLInputElement).checked })} />
              <span />
            </span>
          </div>

          {f.allDay ? (
            <div class="row2 field">
              <div>
                <label class="field-label" for="f-date">Data</label>
                <input id="f-date" class="input" type="date" value={f.date} onInput={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  const span = diffDays(f.date, f.endDate);
                  set({ date: v, endDate: v ? addDays(v, Math.max(0, span)) : f.endDate });
                }} />
              </div>
              <div>
                <label class="field-label" for="f-enddate">Até</label>
                <input id="f-enddate" class="input" type="date" value={f.endDate} min={f.date} onInput={(e) => set({ endDate: (e.target as HTMLInputElement).value })} />
              </div>
            </div>
          ) : (
            <>
              <div class="field">
                <label class="field-label" for="f-date">Data</label>
                <input id="f-date" class="input" type="date" value={f.date} onInput={(e) => set({ date: (e.target as HTMLInputElement).value })} />
              </div>
              <div class="row2 field">
                <div>
                  <label class="field-label" for="f-start">Início</label>
                  <input id="f-start" class="input tnum" type="time" step={300} value={f.startTime} onInput={(e) => onStartTime((e.target as HTMLInputElement).value)} />
                </div>
                <div>
                  <label class="field-label" for="f-end">Fim</label>
                  <input id="f-end" class="input tnum" type="time" step={300} value={f.endTime} onInput={(e) => set({ endTime: (e.target as HTMLInputElement).value })} />
                </div>
              </div>
            </>
          )}

          {conflicts.length ? (
            <div class="notice" role="status" data-testid="conflict-notice">
              <b>Conflito de horário.</b> Você pode salvar mesmo assim.
              <ul>
                {conflicts.map((c) => {
                  const other: any = c.a.id === (event ? event.id : '__new__') ? c.b : c.a;
                  return (
                    <li>
                      {formatRange(other)} — {other.title} ({ui.labels[other.owner as Person]})
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div class="field">
            <label for="f-repeat">Repetir</label>
            <select id="f-repeat" class="select" value={f.repeat} onChange={(e) => set({ repeat: (e.target as HTMLSelectElement).value as Repeat })}>
              <option value="none">Não repetir</option>
              <option value="daily">Diariamente</option>
              <option value="weekly">Semanalmente</option>
              <option value="monthly">Mensalmente</option>
              <option value="yearly">Anualmente</option>
              <option value="custom">Personalizada…</option>
            </select>
            {f.repeat === 'custom' ? (
              <div style={{ marginTop: '10px' }}>
                <div class="inline-row field">
                  <span>A cada</span>
                  <input aria-label="Intervalo" class="input num tnum" type="number" inputMode="numeric" min={1} max={99} value={f.interval} onInput={(e) => set({ interval: Number((e.target as HTMLInputElement).value) })} />
                  <select aria-label="Unidade" class="select" value={f.freq} onChange={(e) => set({ freq: (e.target as HTMLSelectElement).value as Form['freq'] })}>
                    <option value="DAILY">dia(s)</option>
                    <option value="WEEKLY">semana(s)</option>
                    <option value="MONTHLY">mês(es)</option>
                    <option value="YEARLY">ano(s)</option>
                  </select>
                </div>
                {f.freq === 'WEEKLY' ? (
                  <div class="field">
                    <span class="field-label">Nos dias</span>
                    <div class="weekday-picks">
                      {BYDAY.map((d) => (
                        <button type="button" aria-pressed={f.byDay.includes(d)} aria-label={BYDAY_LABELS[d]} onClick={() => {
                          const next = f.byDay.includes(d) ? f.byDay.filter((x) => x !== d) : [...f.byDay, d];
                          set({ byDay: next.length ? next : [d] });
                        }}>
                          {BYDAY_LABELS[d].slice(0, 1).toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div class="inline-row field">
                  <span>Termina</span>
                  <select aria-label="Término da repetição" class="select" value={f.endType} onChange={(e) => set({ endType: (e.target as HTMLSelectElement).value as EndType })}>
                    <option value="never">Nunca</option>
                    <option value="until">Em uma data</option>
                    <option value="count">Após N vezes</option>
                  </select>
                </div>
                {f.endType === 'until' ? (
                  <input aria-label="Data final da repetição" class="input field" type="date" value={f.until} min={f.date} onInput={(e) => set({ until: (e.target as HTMLInputElement).value })} />
                ) : null}
                {f.endType === 'count' ? (
                  <div class="inline-row field">
                    <input aria-label="Número de vezes" class="input num tnum" type="number" inputMode="numeric" min={1} max={999} value={f.count} onInput={(e) => set({ count: Number((e.target as HTMLInputElement).value) })} />
                    <span>vezes</span>
                  </div>
                ) : null}
              </div>
            ) : null}
            {ruleText ? <p class="help">{describeRRule(ruleText)}</p> : null}
          </div>

          <div class="field">
            <label for="f-reminder">Lembrete</label>
            <select id="f-reminder" class="select" value={f.reminder} onChange={(e) => set({ reminder: (e.target as HTMLSelectElement).value as Reminder })}>
              {(REMINDERS as Reminder[]).map((r) => (
                <option value={r}>{REMINDER_LABELS[r]}</option>
              ))}
            </select>
          </div>

          <div class="field">
            <label for="f-location">Local</label>
            <input id="f-location" class="input" type="text" value={f.location} maxLength={LIMITS.location} autocomplete="off" onInput={(e) => set({ location: (e.target as HTMLInputElement).value })} />
          </div>

          <div class="field">
            <label for="f-notes">Observações</label>
            <textarea id="f-notes" class="textarea" value={f.notes} maxLength={LIMITS.notes} onInput={(e) => set({ notes: (e.target as HTMLTextAreaElement).value })} />
          </div>

          {error ? <p class="error-text" role="alert">{error}</p> : null}

          <div class="form-foot">
            <button type="submit" class="btn primary block">Salvar</button>
            <button type="button" class="btn block" onClick={onClose}>Cancelar</button>
            {event ? (
              <button type="button" class="btn danger block" onClick={() => (recurring ? setAsk('delete') : setConfirmDelete(true))}>
                Excluir
              </button>
            ) : null}
          </div>
        </form>
      </Sheet>

      {ask ? (
        <Sheet variant="dialog" title={ask === 'save' ? 'Aplicar alteração a' : 'Excluir'} onClose={() => setAsk(null)} left={null} right={null} testId="scope-dialog">
          <p class="help" style={{ marginTop: 0 }}>Este compromisso se repete. {ask === 'delete' ? 'O que deseja excluir?' : ''}</p>
          <div class="choice-list">
            <button type="button" class="btn block" onClick={() => (ask === 'save' ? persist('this') : doDelete('this'))}>Somente este evento</button>
            <button type="button" class="btn block" onClick={() => (ask === 'save' ? persist('following') : doDelete('following'))}>Este e os próximos</button>
            <button type="button" class={`btn block${ask === 'delete' ? ' danger' : ''}`} onClick={() => (ask === 'save' ? persist('all') : doDelete('all'))}>Toda a série</button>
            <button type="button" class="btn block" onClick={() => setAsk(null)}>Cancelar</button>
          </div>
        </Sheet>
      ) : null}

      {confirmDelete ? (
        <Sheet variant="dialog" title="Excluir?" onClose={() => setConfirmDelete(false)} left={null} right={null} testId="confirm-dialog">
          <p style={{ marginTop: 0 }}>“{f.title}” será removido do calendário.</p>
          <div class="choice-list">
            <button type="button" class="btn primary block" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => doDelete('this')}>Excluir</button>
            <button type="button" class="btn block" onClick={() => setConfirmDelete(false)}>Cancelar</button>
          </div>
        </Sheet>
      ) : null}
    </>
  );
}
