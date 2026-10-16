import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CalEvent, Category, Holiday, Person } from '../shared/types';
import { CATEGORIES, CATEGORY_LABELS, PEOPLE } from '../shared/model.js';
import {
  addDays, addMonths, startOfMonth, startOfWeek, today, MONTHS, MONTHS_SHORT, capitalize, formatLong,
} from '../shared/dates.js';
import { detectConflicts } from '../shared/conflicts.js';
import { matchesFilters } from '../shared/layout.js';
import { engine } from './services/engine';
import { readJSON, writeJSON, KEYS } from './services/storage';
import { onUpdateReady, applyUpdate } from './services/sw';
import { Ui, useEngine, type UiActions } from './components/common';
import { EventSheet } from './components/EventSheet';
import { AccountSheet } from './components/AccountSheet';
import { Sheet, rememberTrigger } from './components/Sheet';
import { MonthView } from './components/MonthView';
import { YearView } from './components/YearView';
import { WeekView } from './components/WeekView';
import { AgendaView } from './components/AgendaView';
import { CoupleView } from './components/CoupleView';
import {
  IconAgenda, IconChevronLeft, IconChevronRight, IconCouple, IconFilter, IconMonth, IconPlus, IconWeek, IconYear, CategoryIcon,
} from './components/Icons';

type View = 'year' | 'month' | 'week' | 'agenda' | 'couple';
const VIEWS: { id: View; label: string; Icon: (p: any) => any }[] = [
  { id: 'year', label: 'Ano', Icon: IconYear },
  { id: 'month', label: 'Mês', Icon: IconMonth },
  { id: 'week', label: 'Semana', Icon: IconWeek },
  { id: 'agenda', label: 'Agenda', Icon: IconAgenda },
  { id: 'couple', label: 'Casal', Icon: IconCouple },
];

interface Prefs {
  view?: View;
  people?: Person[];
  categories?: Category[];
  showBusy?: boolean;
  showObservances?: boolean;
  lastCategory?: Category;
}

type SheetState =
  | null
  | { type: 'new'; preset?: { date?: string; time?: string } }
  | { type: 'edit'; event: CalEvent }
  | { type: 'holiday'; holiday: Holiday }
  | { type: 'account' }
  | { type: 'filters' };

const AUTH_MESSAGES: Record<string, string> = {
  ok: 'Conectado ao Google Calendar.',
  denied: 'Login cancelado.',
  not_allowed: 'Esta conta Google não tem acesso ao calendário da família.',
  state: 'Não foi possível entrar. Tente novamente.',
  failed: 'Não foi possível entrar. Tente novamente.',
  not_configured: 'A conexão com o Google ainda não foi configurada.',
};

const STATUS_LABEL: Record<string, string> = {
  loading: '…',
  local: 'Neste aparelho',
  synced: '✓ Sincronizado',
  syncing: '↻ Sincronizando',
  offline: 'Offline',
  error: 'Erro de sincronização',
  'signed-out': 'Entrar novamente',
  setup: 'Configurar',
};

function viewRange(view: View, cursor: string): [string, string] {
  const t = today();
  switch (view) {
    case 'year':
      return [`${cursor.slice(0, 4)}-01-01`, `${Number(cursor.slice(0, 4)) + 1}-01-01`];
    case 'month': {
      const s = startOfWeek(startOfMonth(cursor));
      return [s, addDays(s, 42)];
    }
    case 'week':
    case 'couple': {
      const s = startOfWeek(cursor);
      return [s, addDays(s, 7)];
    }
    default:
      return [t, addDays(t, 60)];
  }
}

function title(view: View, cursor: string) {
  const [y, m] = cursor.split('-').map(Number);
  if (view === 'year') return { main: String(y) };
  if (view === 'month') return { main: `${capitalize(MONTHS[m - 1])} ${y}` };
  if (view === 'agenda') return { main: 'Agenda', sub: formatLong(today()) };
  const s = startOfWeek(cursor);
  const e = addDays(s, 6);
  const [, sm, sd] = s.split('-').map(Number);
  const [ey, em, ed] = e.split('-').map(Number);
  const label = sm === em ? `${sd}–${ed} ${MONTHS_SHORT[em - 1]} ${ey}` : `${sd} ${MONTHS_SHORT[sm - 1]} – ${ed} ${MONTHS_SHORT[em - 1]} ${ey}`;
  return view === 'couple' ? { main: 'Semana do casal', sub: label } : { main: label };
}

/** Campo invisível que recebe o foco no toque de "+ Novo": no iOS o teclado
 * só abre se o foco acontecer dentro do gesto; ao abrir o formulário o foco
 * passa para o título e o teclado continua aberto. */
function catchFocus(trigger?: Element | null) {
  rememberTrigger(trigger || document.activeElement);
  const el = document.getElementById('focus-catcher') as HTMLInputElement | null;
  if (!el) return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}

export function App() {
  const s = useEngine();
  const [prefs, setPrefs] = useState<Prefs>(() => readJSON<Prefs>(KEYS.prefs, {}));
  const [view, setViewState] = useState<View>(prefs.view || 'month');
  const [cursor, setCursor] = useState(today());
  const [selected, setSelected] = useState(today());
  const [sheet, setSheet] = useState<SheetState>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const people = prefs.people || [];
  const categories = prefs.categories || [];
  const showBusy = prefs.showBusy !== false;

  const savePrefs = (patch: Prefs) => {
    const next = { ...readJSON<Prefs>(KEYS.prefs, {}), ...patch };
    writeJSON(KEYS.prefs, next);
    setPrefs(next);
  };
  const setView = (v: View) => {
    setViewState(v);
    savePrefs({ view: v });
    window.scrollTo(0, 0);
  };

  useEffect(() => onUpdateReady(setUpdateReady), []);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    // Resultado do login (/?auth=...)
    const params = new URLSearchParams(window.location.search);
    const auth = params.get('auth');
    if (auth) {
      if (AUTH_MESSAGES[auth]) engine.notify(AUTH_MESSAGES[auth]);
      history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  useEffect(() => {
    const t = s.toast;
    if (!t) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => engine.clearToast(t.id), 3800);
  }, [s.toast && s.toast.id]);

  // Intervalos que a tela precisa: ano do cursor + agenda (com tarefas atrasadas).
  const [from, to] = viewRange(view, cursor);
  const year = Number(cursor.slice(0, 4));
  useEffect(() => {
    engine.ensureRange(`${year}-01-01`, `${year + 1}-01-08`);
    engine.ensureRange(addDays(today(), -60), addDays(today(), 61));
  }, [year, s.mode, s.status === 'synced' || s.status === 'syncing']);

  const filters = { people, categories };
  const events = useMemo(
    () => engine.eventsInRange(from, to).filter((e) => matchesFilters(e, filters)),
    [from, to, s.version, people.join(), categories.join()],
  );
  const busy = useMemo(
    () => (showBusy && s.busyEnabled ? engine.busyInRange(from, to).filter((b) => !people.length || people.includes(b.owner)) : []),
    [from, to, s.version, showBusy, people.join()],
  );
  const overdue = useMemo(() => {
    if (view !== 'agenda') return [];
    const t = today();
    return engine
      .eventsInRange(addDays(t, -60), t)
      .filter((e) => e.kind === 'task' && e.taskStatus !== 'done' && e.start.slice(0, 10) < t && matchesFilters(e, filters));
  }, [view, s.version, people.join(), categories.join()]);

  const holidays = useMemo(() => {
    const map = new Map<string, Holiday[]>();
    const y1 = Number(from.slice(0, 4));
    const y2 = Number(addDays(to, -1).slice(0, 4));
    for (let y = y1; y <= y2; y++) {
      for (const h of engine.holidaysFor(y)) {
        if (h.date < from || h.date >= to) continue;
        if (h.kind === 'comemorativa' && !prefs.showObservances) continue;
        const list = map.get(h.date) || [];
        list.push(h);
        map.set(h.date, list);
      }
    }
    return map;
  }, [from, to, s.version, prefs.showObservances]);

  const conflictIds = useMemo(() => {
    const ids = new Set<string>();
    const busyItems = busy.map((b) => ({ ...b, allDay: false, busy: true }));
    for (const c of detectConflicts([...events, ...busyItems] as any)) {
      ids.add(c.a.id);
      ids.add(c.b.id);
    }
    return ids;
  }, [events, busy]);

  const ui: UiActions = {
    labels: s.labels,
    conflictIds,
    openEvent: (ev) => setSheet({ type: 'edit', event: ev }),
    openNew: (preset, trigger) => {
      catchFocus(trigger);
      setSheet({ type: 'new', preset });
    },
    openHoliday: (h) => setSheet({ type: 'holiday', holiday: h }),
  };

  const go = (dir: -1 | 1) => {
    if (view === 'year') setCursor(`${year + dir}-${cursor.slice(5)}`.replace(/-02-29$/, '-02-28'));
    else if (view === 'month') {
      const c = addMonths(startOfMonth(cursor), dir);
      setCursor(c);
      setSelected(c.slice(0, 7) === today().slice(0, 7) ? today() : c);
    } else setCursor(addDays(cursor, dir * 7));
  };
  const goToday = () => {
    setCursor(today());
    setSelected(today());
    if (view === 'week') {
      const el = document.querySelector('[data-testid="week-grid"]');
      if (el) el.scrollTop = 0;
    }
  };

  const tt = title(view, cursor);
  const statusLabel = STATUS_LABEL[s.status] || '';
  const togglePerson = (p: Person) => savePrefs({ people: people.includes(p) ? people.filter((x) => x !== p) : [...people, p] });

  return (
    <Ui.Provider value={ui}>
      <div id="main" class="app">
        <header class={`topbar${scrolled ? ' scrolled' : ''}`}>
          <div class="topbar-row">
            <div class="title-block">
              <h1 class="title" aria-live="polite">{tt.main}</h1>
              <div class="title-sub">
                {tt.sub ? <span>{tt.sub}</span> : null}
                <button
                  type="button"
                  class="status-pill"
                  data-state={s.status}
                  data-testid="sync-status"
                  aria-label={`Sincronização: ${statusLabel}. Abrir conta e sincronização`}
                  onClick={() => setSheet({ type: 'account' })}
                >
                  <span class="dot" aria-hidden="true" />
                  <span class="label">{statusLabel}</span>
                </button>
              </div>
            </div>
            <div class="nav-cluster">
              {view !== 'agenda' ? (
                <button type="button" class="icon-btn" aria-label="Anterior" onClick={() => go(-1)}>
                  <IconChevronLeft />
                </button>
              ) : null}
              <button type="button" class="text-btn" onClick={goToday}>
                Hoje
              </button>
              {view !== 'agenda' ? (
                <button type="button" class="icon-btn" aria-label="Próximo" onClick={() => go(1)}>
                  <IconChevronRight />
                </button>
              ) : null}
            </div>
          </div>
          <div class="filters" role="toolbar" aria-label="Filtros">
            <button type="button" class="chip" aria-pressed={!people.length} onClick={() => savePrefs({ people: [] })}>
              Todos
            </button>
            {(PEOPLE as Person[]).map((p) => (
              <button type="button" class="chip" data-owner={p} aria-pressed={people.includes(p)} onClick={() => togglePerson(p)}>
                <span class="swatch" style={{ background: 'var(--person)' }} aria-hidden="true" />
                {s.labels[p]}
              </button>
            ))}
            <button type="button" class="chip" aria-pressed={categories.length > 0} onClick={() => setSheet({ type: 'filters' })}>
              <IconFilter />
              {categories.length ? `Categorias (${categories.length})` : 'Categorias'}
            </button>
            {s.busyEnabled ? (
              <button type="button" class="chip" aria-pressed={showBusy} onClick={() => savePrefs({ showBusy: !showBusy })}>
                Ocupado
              </button>
            ) : null}
          </div>
        </header>

        <main class="content">
          {view === 'year' ? (
            <YearView
              year={year}
              events={events}
              holidays={holidays}
              onDay={(d) => {
                setCursor(d);
                setSelected(d);
                setView('month');
              }}
              onMonth={(d) => {
                setCursor(d);
                setSelected(d.slice(0, 7) === today().slice(0, 7) ? today() : d);
                setView('month');
              }}
            />
          ) : null}
          {view === 'month' ? (
            <MonthView cursor={cursor} selected={selected} events={events} holidays={holidays} onSelect={setSelected} />
          ) : null}
          {view === 'week' ? <WeekView weekStart={startOfWeek(cursor)} events={events} busy={busy} holidays={holidays} /> : null}
          {view === 'agenda' ? <AgendaView events={events} overdue={overdue} holidays={holidays} days={60} /> : null}
          {view === 'couple' ? <CoupleView weekStart={startOfWeek(cursor)} events={events} busy={busy} holidays={holidays} /> : null}
        </main>

        <button
          type="button"
          class="fab"
          data-testid="new-button"
          onClick={(e) => ui.openNew(view === 'month' ? { date: selected } : undefined, e.currentTarget as Element)}
        >
          <IconPlus />
          Novo
        </button>

        <nav class="tabbar" aria-label="Visões">
          {VIEWS.map(({ id, label, Icon }) => (
            <button type="button" class="tab" aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
              <Icon />
              {label}
            </button>
          ))}
        </nav>

        {updateReady ? (
          <div class="banner" role="status" data-testid="update-banner">
            <p>Nova versão disponível</p>
            <button type="button" class="btn primary" onClick={applyUpdate}>
              Atualizar
            </button>
          </div>
        ) : s.migration ? (
          <div class="banner stack" role="status" data-testid="migration-banner">
            <p>
              Encontramos compromissos salvos neste aparelho ({s.migration.count}). Deseja importá-los para o calendário compartilhado?
            </p>
            <div class="actions">
              <button type="button" class="btn" onClick={() => engine.dismissMigration()}>
                Agora não
              </button>
              <button type="button" class="btn primary" onClick={() => engine.importMigration()}>
                Importar
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <input id="focus-catcher" class="sr-only" type="text" aria-hidden="true" tabIndex={-1} autocomplete="off" />

      {s.toast ? (
        <div class="toast" role="status" aria-live="polite" data-testid="toast">
          {s.toast.text}
        </div>
      ) : null}

      {sheet && sheet.type === 'new' ? <EventSheet preset={sheet.preset} onClose={() => setSheet(null)} /> : null}
      {sheet && sheet.type === 'edit' ? <EventSheet event={sheet.event} onClose={() => setSheet(null)} /> : null}
      {sheet && sheet.type === 'account' ? (
        <AccountSheet onClose={() => setSheet(null)} onPrefs={() => setPrefs(readJSON<Prefs>(KEYS.prefs, {}))} />
      ) : null}
      {sheet && sheet.type === 'holiday' ? (
        <Sheet variant="dialog" title={sheet.holiday.name} onClose={() => setSheet(null)} left={null} right={null}>
          <p style={{ marginTop: 0 }}>{formatLong(sheet.holiday.date)}</p>
          <p class="help">
            {sheet.holiday.kind === 'feriado' ? 'Feriado' : sheet.holiday.kind === 'facultativo' ? 'Ponto facultativo' : 'Data comemorativa'}
            {sheet.holiday.scope === 'municipal' ? ' municipal (Chapecó)' : sheet.holiday.scope === 'estadual' ? ' estadual (SC)' : sheet.holiday.scope === 'nacional' ? ' nacional' : ''}
            {' · '}
            {sheet.holiday.source === 'google' ? 'Fonte: Google — Feriados no Brasil' : 'Fonte: cálculo local'}
          </p>
          <button type="button" class="btn block" onClick={() => setSheet(null)}>
            Fechar
          </button>
        </Sheet>
      ) : null}
      {sheet && sheet.type === 'filters' ? (
        <Sheet title="Categorias" onClose={() => setSheet(null)} left={<button type="button" class="text-btn" onClick={() => savePrefs({ categories: [] })}>Limpar</button>} right={<button type="button" class="text-btn" onClick={() => setSheet(null)}>OK</button>}>
          <p class="help" style={{ marginTop: 0 }}>Combine com o filtro de pessoa. Sem seleção, todas as categorias aparecem.</p>
          <div class="cat-grid">
            {(CATEGORIES as Category[]).map((c) => (
              <button
                type="button"
                class="cat-opt"
                role="checkbox"
                aria-checked={categories.includes(c)}
                onClick={() => savePrefs({ categories: categories.includes(c) ? categories.filter((x) => x !== c) : [...categories, c] })}
              >
                <CategoryIcon category={c} />
                {CATEGORY_LABELS[c]}
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}
    </Ui.Provider>
  );
}
