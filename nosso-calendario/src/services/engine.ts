// Motor de dados do app.
//
// Modo "google": o Google Calendar é a fonte da verdade. O app mantém um
// cache para abrir offline e uma fila de alterações. Cada criação leva um ID
// gerado aqui, então reenviar (queda de conexão no meio) não duplica.
// Modo "local": antes de conectar o Google, os dados ficam no aparelho e são
// oferecidos para importação quando a conexão for feita.

import type { BusyBlock, CalEvent, EventInput, Holiday, Person } from '../../shared/types';
import { DEFAULT_PERSON_LABELS, bytesToBase32hex } from '../../shared/model.js';
import { addDays, diffDays, diffMinutesWall, addMinutesWall, today, eventDays } from '../../shared/dates.js';
import { expandOccurrences, instanceId } from '../../shared/recurrence.js';
import { mergeHolidays } from '../../shared/holidays.js';
import { api, ApiError } from './api';
import { KEYS, readJSON, writeJSON } from './storage';
import { createLocal, deleteLocal, expandLocal, updateLocal, type Scope } from './local-store';
import { detectLegacy, parseImportFile, stableId, type MigrationItem } from './migration';

export type SyncStatus = 'loading' | 'local' | 'synced' | 'syncing' | 'offline' | 'error' | 'signed-out' | 'setup';

export interface Me {
  configured: boolean;
  authenticated: boolean;
  email?: string;
  name?: string;
  person?: Person;
  labels?: Record<Person, string>;
  calendar?: { id: string; summary: string } | null;
  calendarName?: string;
  busyEnabled?: boolean;
  reason?: string;
}

type Op =
  | { opId: string; kind: 'create'; id: string; event: EventInput; migrationId?: string; title: string }
  | { opId: string; kind: 'update'; id: string; scope: Scope; event: EventInput; seriesId?: string; originalStart?: string; newId?: string; title: string }
  | { opId: string; kind: 'delete'; id: string; scope: Scope; seriesId?: string; originalStart?: string; title: string };

interface Range {
  from: string;
  to: string;
  at: number;
}

export interface EngineState {
  mode: 'local' | 'google';
  status: SyncStatus;
  me: Me | null;
  lastSync: number | null;
  queueSize: number;
  labels: Record<Person, string>;
  toast: { id: number; text: string } | null;
  migration: { count: number } | null;
  busyEnabled: boolean;
  version: number;
}

function randomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase32hex(bytes);
}

function overlaps(ev: { start: string; end: string; allDay: boolean }, from: string, to: string) {
  const days = eventDays(ev);
  return days.length > 0 && days[0] < to && days[days.length - 1] >= from;
}

const STALE_MS = 45_000;

export class Engine {
  private listeners = new Set<() => void>();
  state: EngineState;
  private server: CalEvent[];
  private ranges: Range[];
  private queue: Op[];
  private local: CalEvent[];
  private busy: { blocks: BusyBlock[]; ranges: Range[] } = { blocks: [], ranges: [] };
  private googleHolidays: Record<string, { at: number; list: Holiday[] }>;
  private wanted: { from: string; to: string }[] = [];
  private flushing = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private toastSeq = 0;
  private migrationItems: MigrationItem[] = [];

  constructor() {
    const cache = readJSON<{ events: CalEvent[]; ranges: Range[]; lastSync: number | null }>(KEYS.cache, {
      events: [],
      ranges: [],
      lastSync: null,
    });
    const me = readJSON<Me | null>(KEYS.me, null);
    this.server = Array.isArray(cache.events) ? cache.events : [];
    this.ranges = [];
    this.queue = readJSON<Op[]>(KEYS.queue, []);
    this.local = readJSON<CalEvent[]>(KEYS.local, []);
    this.googleHolidays = readJSON(KEYS.holidays, {});
    const google = !!(me && me.authenticated && me.calendar);
    this.state = {
      mode: google ? 'google' : 'local',
      status: 'loading',
      me,
      lastSync: cache.lastSync || null,
      queueSize: this.queue.length,
      labels: { ...DEFAULT_PERSON_LABELS, ...((me && me.labels) || {}) },
      toast: null,
      migration: null,
      busyEnabled: !!(me && me.busyEnabled),
      version: 0,
    };
  }

  // ---------- assinatura (Preact) ----------
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private set(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch, version: this.state.version + 1 };
    for (const fn of this.listeners) fn();
  }
  notify(text: string) {
    this.set({ toast: { id: ++this.toastSeq, text } });
  }
  clearToast(id: number) {
    if (this.state.toast && this.state.toast.id === id) this.set({ toast: null });
  }

  // ---------- inicialização ----------
  async start() {
    window.addEventListener('online', () => this.onOnline());
    window.addEventListener('offline', () => {
      if (this.state.mode === 'google') this.set({ status: 'offline' });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.refresh();
    });
    setInterval(() => {
      if (document.visibilityState === 'visible') this.refresh();
    }, 60_000);
    if (this.state.mode === 'local') this.set({ status: 'local' });
    else this.set({ status: navigator.onLine === false ? 'offline' : 'syncing' });
    await this.loadMe();
  }

  private persistCache() {
    writeJSON(KEYS.cache, { events: this.server, ranges: this.ranges, lastSync: this.state.lastSync });
  }
  private persistQueue() {
    writeJSON(KEYS.queue, this.queue);
  }
  private persistLocal() {
    writeJSON(KEYS.local, this.local);
  }

  async loadMe() {
    let me: Me;
    try {
      me = await api<Me>('GET', '/api/me');
    } catch (e) {
      // Sem rede: mantém o que já se sabia.
      if (this.state.mode === 'google') this.set({ status: 'offline' });
      else this.set({ status: 'local' });
      return;
    }
    writeJSON(KEYS.me, me);
    const labels = { ...DEFAULT_PERSON_LABELS, ...(me.labels || {}) };
    if (me.authenticated && me.calendar) {
      this.set({ me, labels, mode: 'google', busyEnabled: !!me.busyEnabled, status: 'syncing' });
      await this.flush();
      await this.refresh(true);
      this.checkMigration();
      return;
    }
    if (me.authenticated && !me.calendar) {
      this.set({ me, labels, status: 'setup' });
      return;
    }
    // Não autenticado. Se havia sessão (modo google), avisa para entrar de novo
    // e continua mostrando o cache.
    if (this.state.mode === 'google') this.set({ me, labels, status: 'signed-out' });
    else this.set({ me, labels, status: 'local', mode: 'local' });
  }

  private onOnline() {
    if (this.state.mode !== 'google') return;
    if (this.state.status === 'signed-out' || this.state.status === 'setup') return;
    this.loadMe();
  }

  // ---------- leitura ----------
  /** Informa ao motor quais intervalos a tela precisa (busca se estiverem velhos). */
  ensureRange(from: string, to: string) {
    if (!this.wanted.some((w) => w.from === from && w.to === to)) {
      this.wanted = [{ from, to }, ...this.wanted].slice(0, 4);
    }
    if (this.state.mode !== 'google') return;
    const fresh = this.ranges.some((r) => r.from <= from && r.to >= to && Date.now() - r.at < STALE_MS);
    if (!fresh) this.fetchRange(from, to);
  }

  private inflight = new Map<string, Promise<void>>();
  private async fetchRange(from: string, to: string) {
    const key = `${from}|${to}`;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const job = (async () => {
      try {
        if (this.state.status !== 'syncing') this.set({ status: 'syncing' });
        const data = await api<{ events: CalEvent[] }>('GET', `/api/events?from=${from}&to=${to}`);
        const ids = new Set(data.events.map((e) => e.id));
        this.server = this.server.filter((e) => !ids.has(e.id) && !overlaps(e, from, to)).concat(data.events);
        this.ranges = [{ from, to, at: Date.now() }, ...this.ranges.filter((r) => !(r.from === from && r.to === to))].slice(0, 8);
        this.persistCache();
        this.set({ lastSync: Date.now(), status: this.queue.length ? 'syncing' : 'synced' });
        if (this.state.busyEnabled) this.fetchBusy(from, to);
      } catch (e) {
        this.handleError(e);
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, job);
    return job;
  }

  private async fetchBusy(from: string, to: string) {
    // free/busy aceita até 120 dias: busca só a parte próxima.
    const start = from < addDays(today(), -7) ? addDays(today(), -7) : from;
    const end = addDays(start, 100) < to ? addDays(start, 100) : to;
    if (end <= start) return;
    try {
      const data = await api<{ enabled: boolean; blocks: BusyBlock[] }>('GET', `/api/freebusy?from=${start}&to=${end}`);
      if (!data.enabled) return;
      this.busy.blocks = this.busy.blocks.filter((b) => !(b.start.slice(0, 10) >= start && b.start.slice(0, 10) < end)).concat(data.blocks);
      this.set({});
    } catch {
      /* disponibilidade é complementar: falha silenciosa */
    }
  }

  async refresh(force = false) {
    if (this.state.mode !== 'google') return;
    if (this.state.status === 'signed-out' || this.state.status === 'setup') return;
    if (this.queue.length) await this.flush();
    for (const w of this.wanted) {
      const fresh = this.ranges.some((r) => r.from <= w.from && r.to >= w.to && Date.now() - r.at < STALE_MS);
      if (force || !fresh) await this.fetchRange(w.from, w.to);
    }
  }

  /** Compromissos visíveis no intervalo [from, to) já com alterações pendentes. */
  eventsInRange(from: string, to: string): CalEvent[] {
    if (this.state.mode === 'local') return expandLocal(this.local, from, to);
    return this.applyQueue(this.server.filter((e) => overlaps(e, from, to)), from, to);
  }

  busyInRange(from: string, to: string): BusyBlock[] {
    return this.busy.blocks.filter((b) => b.start.slice(0, 10) < to && b.end.slice(0, 10) >= from);
  }

  holidaysFor(year: number): Holiday[] {
    const cached = this.googleHolidays[String(year)];
    if (this.state.mode === 'google' && (!cached || Date.now() - cached.at > 7 * 86400000)) this.fetchHolidays(year);
    return mergeHolidays(year, cached ? cached.list : null);
  }

  private holidayInflight = new Set<number>();
  private async fetchHolidays(year: number) {
    if (this.holidayInflight.has(year)) return;
    this.holidayInflight.add(year);
    try {
      const data = await api<{ holidays: Holiday[] }>('GET', `/api/holidays?year=${year}`);
      this.googleHolidays = { ...this.googleHolidays, [String(year)]: { at: Date.now(), list: data.holidays } };
      writeJSON(KEYS.holidays, this.googleHolidays);
      this.set({});
    } catch {
      /* fica com o cálculo local */
    } finally {
      this.holidayInflight.delete(year);
    }
  }

  /** Visão otimista: aplica a fila sobre os dados do servidor. */
  private applyQueue(events: CalEvent[], from: string, to: string): CalEvent[] {
    let list = events;
    for (const op of this.queue) {
      if (op.kind === 'create') {
        const ev = op.event;
        const occ = expandOccurrences(ev, from, to);
        for (const o of occ) {
          list = list.concat({
            ...ev,
            id: ev.rrule ? instanceId(op.id, o.originalStart, ev.allDay) : op.id,
            seriesId: ev.rrule ? op.id : undefined,
            originalStart: ev.rrule ? o.originalStart : undefined,
            start: o.start,
            end: o.end,
            source: 'google',
            pending: true,
          });
        }
      } else if (op.kind === 'update') {
        const inSeries = (e: CalEvent) =>
          op.seriesId && e.seriesId === op.seriesId &&
          (op.scope === 'all' || (op.scope === 'following' && e.originalStart && op.originalStart && e.originalStart >= op.originalStart));
        list = list.map((e) => {
          if (e.id === op.id) return { ...e, ...op.event, id: e.id, seriesId: e.seriesId, originalStart: e.originalStart, pending: true };
          if (op.scope !== 'this' && inSeries(e) && op.originalStart) {
            const delta = diffDays(op.originalStart.slice(0, 10), op.event.start.slice(0, 10));
            const date = addDays((e.originalStart || e.start).slice(0, 10), delta);
            const start = op.event.allDay ? date : `${date}T${op.event.start.slice(11)}`;
            const end = op.event.allDay
              ? addDays(date, diffDays(op.event.start, op.event.end))
              : addMinutesWall(start, diffMinutesWall(op.event.start, op.event.end));
            return { ...e, ...op.event, start, end, id: e.id, seriesId: e.seriesId, originalStart: e.originalStart, pending: true };
          }
          return e;
        });
      } else if (op.kind === 'delete') {
        list = list.filter((e) => {
          if (e.id === op.id) return false;
          if (!op.seriesId || e.seriesId !== op.seriesId || op.scope === 'this') return true;
          if (op.scope === 'all') return false;
          return !(e.originalStart && op.originalStart && e.originalStart >= op.originalStart);
        });
      }
    }
    return list;
  }

  // ---------- escrita ----------
  async create(input: EventInput) {
    const id = randomId();
    if (this.state.mode === 'local') {
      this.local = createLocal(this.local, input, id);
      this.persistLocal();
      this.set({});
      return;
    }
    this.enqueue({ opId: randomId(), kind: 'create', id, event: input, title: input.title });
  }

  async update(target: CalEvent, input: EventInput, scope: Scope) {
    if (this.state.mode === 'local') {
      this.local = updateLocal(this.local, target, input, scope, randomId());
      this.persistLocal();
      this.set({});
      return;
    }
    // Item ainda na fila de criação: atualiza a própria criação.
    const pendingCreate = this.queue.find((o) => o.kind === 'create' && (o.id === target.id || o.id === target.seriesId));
    if (pendingCreate && pendingCreate.kind === 'create' && (!target.seriesId || scope === 'all')) {
      pendingCreate.event = input;
      pendingCreate.title = input.title;
      this.persistQueue();
      this.set({});
      this.flush();
      return;
    }
    this.enqueue({
      opId: randomId(), kind: 'update', id: target.id, scope, event: input, title: input.title,
      seriesId: target.seriesId, originalStart: target.originalStart, newId: scope === 'following' ? randomId() : undefined,
    });
  }

  async remove(target: CalEvent, scope: Scope) {
    if (this.state.mode === 'local') {
      this.local = deleteLocal(this.local, target, scope);
      this.persistLocal();
      this.set({});
      return;
    }
    const idx = this.queue.findIndex((o) => o.kind === 'create' && (o.id === target.id || (o.id === target.seriesId && scope === 'all')));
    if (idx >= 0) {
      // Nunca chegou ao Google: basta tirar da fila.
      this.queue.splice(idx, 1);
      this.persistQueue();
      this.set({ queueSize: this.queue.length });
      return;
    }
    this.enqueue({
      opId: randomId(), kind: 'delete', id: target.id, scope, title: target.title,
      seriesId: target.seriesId, originalStart: target.originalStart,
    });
  }

  async toggleTask(target: CalEvent) {
    const { id: _id, seriesId: _s, originalStart: _o, source: _src, pending: _p, updated: _u, createdBy: _c, ...rest } = target;
    const input: EventInput = { ...rest, taskStatus: target.taskStatus === 'done' ? 'pending' : 'done' };
    await this.update(target, input, 'this');
  }

  private enqueue(op: Op) {
    this.queue.push(op);
    this.persistQueue();
    this.set({ queueSize: this.queue.length });
    if (navigator.onLine === false) {
      this.set({ status: 'offline' });
      this.notify('Alteração salva neste aparelho e será sincronizada quando a conexão voltar.');
      return;
    }
    this.flush();
  }

  private async send(op: Op) {
    if (op.kind === 'create') {
      await api('POST', '/api/events', { id: op.id, event: op.event, migrationId: op.migrationId });
    } else if (op.kind === 'update') {
      await api('PATCH', `/api/events?id=${encodeURIComponent(op.id)}&scope=${op.scope}`, {
        event: op.event, seriesId: op.seriesId, originalStart: op.originalStart, newId: op.newId,
      });
    } else {
      const q = new URLSearchParams({ id: op.id, scope: op.scope });
      if (op.seriesId) q.set('seriesId', op.seriesId);
      if (op.originalStart) q.set('originalStart', op.originalStart);
      await api('DELETE', `/api/events?${q.toString()}`);
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.state.mode !== 'google' || !this.queue.length) return;
    if (this.state.status === 'signed-out' || this.state.status === 'setup') return;
    this.flushing = true;
    this.set({ status: 'syncing' });
    let sentAny = false;
    try {
      while (this.queue.length) {
        const op = this.queue[0];
        try {
          await this.send(op);
          this.queue.shift();
          sentAny = true;
          this.persistQueue();
          this.set({ queueSize: this.queue.length });
        } catch (e) {
          if (e instanceof ApiError && !e.retriable && e.status !== 401 && !(e.status === 409 && e.code === 'no_calendar') && e.status !== 403) {
            // Rejeitado de forma definitiva (dados inválidos, já excluído):
            // descarta para não travar a fila e avisa de forma clara.
            this.queue.shift();
            this.persistQueue();
            this.set({ queueSize: this.queue.length });
            this.notify(e.status === 404 ? `“${op.title}” não existe mais no calendário.` : `Não foi possível salvar “${op.title}”: ${e.message}`);
            continue;
          }
          this.handleError(e);
          return;
        }
      }
    } finally {
      this.flushing = false;
    }
    if (sentAny) {
      this.ranges = this.ranges.map((r) => ({ ...r, at: 0 }));
      await this.refresh(true);
    }
  }

  private handleError(e: unknown) {
    const err = e instanceof ApiError ? e : new ApiError(0, 'network', 'Você está offline.');
    if (err.status === 0) {
      this.set({ status: 'offline' });
      this.scheduleRetry();
    } else if (err.status === 401) {
      this.set({ status: 'signed-out' });
    } else if (err.status === 409 && err.code === 'no_calendar') {
      this.set({ status: 'setup' });
    } else {
      this.set({ status: 'error' });
      this.scheduleRetry();
    }
  }

  private scheduleRetry() {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (navigator.onLine !== false) this.loadMe();
    }, 30_000);
  }

  // ---------- conta ----------
  login() {
    const email = this.state.me && this.state.me.email;
    window.location.href = `/api/auth/login${email ? `?hint=${encodeURIComponent(email)}` : ''}`;
  }
  async logout() {
    try {
      await api('POST', '/api/auth/logout', {});
    } catch {
      /* mesmo sem rede, encerra localmente */
    }
    writeJSON(KEYS.me, null);
    writeJSON(KEYS.cache, { events: [], ranges: [], lastSync: null });
    this.server = [];
    this.ranges = [];
    this.set({ me: { configured: true, authenticated: false }, mode: 'local', status: 'local', lastSync: null });
  }
  async setupCalendar() {
    try {
      const r = await api<{ created: boolean; shared: string[] }>('POST', '/api/setup', {});
      this.notify(r.created ? 'Calendário criado e compartilhado.' : 'Calendário encontrado.');
      await this.loadMe();
    } catch (e) {
      this.notify(e instanceof ApiError ? e.message : 'Não foi possível criar o calendário.');
    }
  }
  async syncNow() {
    if (this.state.mode !== 'google') return this.loadMe();
    this.ranges = this.ranges.map((r) => ({ ...r, at: 0 }));
    await this.loadMe();
  }

  // ---------- migração / importação ----------
  /** Há compromissos salvos no aparelho que ainda não foram importados? */
  async checkMigration() {
    const record = readJSON<{ dismissed?: boolean; ids?: string[] }>(KEYS.migration, {});
    const migrated = new Set(record.ids || []);
    const pending: MigrationItem[] = [];
    for (const it of detectLegacy()) {
      if (!migrated.has(await stableId(`${it.key}|${JSON.stringify(it.raw)}`))) pending.push(it);
    }
    this.migrationItems = pending;
    this.set({ migration: pending.length && !record.dismissed ? { count: pending.length } : null });
  }
  hasLocalData() {
    return detectLegacy().length > 0;
  }
  dismissMigration() {
    writeJSON(KEYS.migration, { ...readJSON(KEYS.migration, {}), dismissed: true });
    this.set({ migration: null });
  }
  async importMigration() {
    const items = this.migrationItems.length ? this.migrationItems : detectLegacy();
    const ids: string[] = [];
    for (const it of items) {
      const id = await stableId(`${it.key}|${JSON.stringify(it.raw)}`);
      ids.push(id);
      if (this.queue.some((o) => o.kind === 'create' && o.id === id)) continue;
      this.queue.push({ opId: randomId(), kind: 'create', id, event: it.input, migrationId: id.slice(0, 16), title: it.input.title });
    }
    const prev = readJSON<{ ids?: string[] }>(KEYS.migration, {});
    writeJSON(KEYS.migration, { at: new Date().toISOString(), ids: Array.from(new Set([...(prev.ids || []), ...ids])) });
    this.persistQueue();
    this.set({ migration: null, queueSize: this.queue.length });
    this.notify(`${ids.length} compromisso(s) enviados ao calendário compartilhado.`);
    await this.flush();
  }
  async importFile(name: string, text: string) {
    const inputs = parseImportFile(name, text);
    if (!inputs.length) {
      this.notify('Nenhum compromisso reconhecido neste arquivo.');
      return 0;
    }
    for (const input of inputs) {
      const id = await stableId(`file|${JSON.stringify(input)}`);
      if (this.state.mode === 'local') {
        if (!this.local.some((e) => e.id === id)) this.local = createLocal(this.local, input, id);
      } else if (!this.queue.some((o) => o.kind === 'create' && o.id === id)) {
        this.queue.push({ opId: randomId(), kind: 'create', id, event: input, migrationId: id.slice(0, 16), title: input.title });
      }
    }
    if (this.state.mode === 'local') this.persistLocal();
    else this.persistQueue();
    this.set({ queueSize: this.queue.length });
    this.notify(`${inputs.length} compromisso(s) importados.`);
    this.flush();
    return inputs.length;
  }
  backupJSON() {
    const events = this.state.mode === 'local' ? this.local : this.server;
    return JSON.stringify({ app: 'nosso-calendario', exportedAt: new Date().toISOString(), events }, null, 2);
  }
}

export const engine = new Engine();
