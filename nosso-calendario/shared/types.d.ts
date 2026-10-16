export type Person = 'eduardo' | 'esposa' | 'casal';
export type Category = 'familia' | 'trabalho' | 'filhos' | 'viagens' | 'saude' | 'lazer' | 'casa' | 'pessoal';
export type Kind = 'event' | 'task';
export type TaskStatus = 'pending' | 'done';
export type Reminder = 'none' | '0' | '10' | '30' | '60' | '1440';

/**
 * Datas sempre em hora de parede de São Paulo:
 * - dia inteiro: 'YYYY-MM-DD' (fim exclusivo, igual ao Google)
 * - com horário: 'YYYY-MM-DDTHH:MM'
 */
export interface EventInput {
  title: string;
  owner: Person;
  category: Category;
  kind: Kind;
  taskStatus?: TaskStatus;
  allDay: boolean;
  start: string;
  end: string;
  location: string;
  notes: string;
  reminder: Reminder;
  /** Regra RFC 5545 sem o prefixo 'RRULE:' */
  rrule?: string;
  /** Ocorrências excluídas da série (hora de parede ou data) */
  exdates?: string[];
}

export interface CalEvent extends EventInput {
  /** ID da instância (Google) ou do evento local */
  id: string;
  /** ID da série quando é ocorrência de evento recorrente */
  seriesId?: string;
  /** Início original da ocorrência dentro da série */
  originalStart?: string;
  source: 'google' | 'local';
  /** Alteração ainda não confirmada pelo Google */
  pending?: boolean;
  updated?: string;
  createdBy?: string;
}

export interface BusyBlock {
  id: string;
  owner: Person;
  start: string;
  end: string;
}

export interface Holiday {
  date: string;
  name: string;
  /** feriado = nacional/estadual/municipal; facultativo; comemorativa */
  kind: 'feriado' | 'facultativo' | 'comemorativa';
  scope: 'nacional' | 'estadual' | 'municipal' | 'google';
  source: 'google' | 'local';
}
