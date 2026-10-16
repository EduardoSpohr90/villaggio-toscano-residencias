// Modal próprio (bottom sheet no iPhone, janela central em telas largas).
//
// Por que não <dialog>/showModal(): no iOS anterior ao 15.4 showModal() não
// existe e lança TypeError; um erro assim, no clique de "+ Novo", deixa o
// botão "morto". Este componente usa apenas DOM e CSS básicos.

import { useEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

let returnTarget: HTMLElement | null = null;
/** Quem abriu o modal (para devolver o foco ao fechar). */
export function rememberTrigger(el: Element | null) {
  returnTarget = el instanceof HTMLElement && el.id !== 'focus-catcher' ? el : null;
}

let locks = 0;
let savedY = 0;

function lockScroll() {
  if (locks++ > 0) return;
  savedY = window.scrollY || 0;
  const b = document.body.style;
  // iOS ignora overflow:hidden no body; fixar o body impede a rolagem
  // do fundo sem perder a posição.
  b.position = 'fixed';
  b.top = `-${savedY}px`;
  b.left = '0';
  b.right = '0';
  b.width = '100%';
  document.body.classList.add('scroll-locked');
}
function unlockScroll() {
  if (--locks > 0) return;
  locks = 0;
  const b = document.body.style;
  b.position = '';
  b.top = '';
  b.left = '';
  b.right = '';
  b.width = '';
  document.body.classList.remove('scroll-locked');
  window.scrollTo(0, savedY);
}

// Pilha de modais abertos: Esc fecha sempre o de cima, esteja o foco onde estiver.
const stack: Array<{ close: () => void }> = [];
let escBound = false;
function bindEscape() {
  if (escBound) return;
  escBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !stack.length) return;
    e.preventDefault();
    stack[stack.length - 1].close();
  });
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface Props {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  variant?: 'sheet' | 'dialog';
  left?: ComponentChildren;
  right?: ComponentChildren;
  /** Elemento a focar ao abrir (padrão: o próprio painel). */
  initialFocus?: string;
  testId?: string;
}

export function Sheet({ title, onClose, children, variant = 'sheet', left, right, initialFocus, testId }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useRef(`sheet-${Math.random().toString(36).slice(2, 8)}`).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const previous = active && active.id === 'focus-catcher' ? returnTarget : active;
    lockScroll();
    const app = document.getElementById('main');
    if (app && locks === 1) app.setAttribute('aria-hidden', 'true');
    const el = panel.current;
    const target = (initialFocus && el && (el.querySelector(initialFocus) as HTMLElement)) || el;
    // Foco sem rolar a página (o iOS rola até o campo focado).
    try {
      target && target.focus({ preventScroll: true });
    } catch {
      target && target.focus();
    }
    const entry = { close: () => closeRef.current() };
    stack.push(entry);
    bindEscape();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && el) {
        const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    el && el.addEventListener('keydown', onKey);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      el && el.removeEventListener('keydown', onKey);
      if (app && locks === 1) app.removeAttribute('aria-hidden');
      unlockScroll();
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
        try {
          previous.focus({ preventScroll: true });
        } catch {
          previous.focus();
        }
      }
    };
  }, []);

  return (
    <div
      class="overlay"
      onClick={(e) => {
        // Fecha só ao tocar no fundo, nunca por um toque que começou no painel.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        class={`sheet${variant === 'dialog' ? ' dialog' : ''}`}
        role={variant === 'dialog' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
      >
        {variant === 'sheet' ? <div class="sheet-grip" aria-hidden="true" /> : null}
        <div class="sheet-head">
          {left !== undefined ? left : <span style={{ width: '84px' }} />}
          <h2 id={titleId}>{title}</h2>
          {right !== undefined ? right : <span style={{ width: '84px' }} />}
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}
