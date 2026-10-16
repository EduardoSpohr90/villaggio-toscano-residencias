import type { Category } from '../../shared/types';

type P = { title?: string };

function Svg({ children, title }: { children: any; title?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const IconChevronLeft = (p: P) => <Svg {...p}><path d="M15 5l-7 7 7 7" /></Svg>;
export const IconChevronRight = (p: P) => <Svg {...p}><path d="M9 5l7 7-7 7" /></Svg>;
export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="M5 12.5l4.2 4.2L19 7" stroke-width="2.6" /></Svg>;
export const IconYear = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Svg>
);
export const IconMonth = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    <path d="M8 13.5h.01M12 13.5h.01M16 13.5h.01M8 17h.01M12 17h.01" stroke-width="2.4" />
  </Svg>
);
export const IconWeek = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="17" height="16.5" rx="2.5" />
    <path d="M9.2 4v16.5M14.8 4v16.5" />
    <rect x="10.6" y="8" width="2.8" height="5" rx="1" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconAgenda = (p: P) => (
  <Svg {...p}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" stroke-width="2.8" />
  </Svg>
);
export const IconCouple = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="12" r="5.5" />
    <circle cx="15" cy="12" r="5.5" />
  </Svg>
);
export const IconFilter = (p: P) => <Svg {...p}><path d="M4 6h16M7 12h10M10 18h4" /></Svg>;
export const IconClose = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6L6 18" /></Svg>;

const CAT: Record<Category, (p: P) => any> = {
  familia: (p) => (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9.5" r="2.3" />
      <path d="M3.5 19c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5M14.5 14.6c.7-.4 1.5-.6 2.5-.6 2.2 0 3.6 1.4 4 4" />
    </Svg>
  ),
  trabalho: (p) => (
    <Svg {...p}>
      <rect x="3.5" y="7" width="17" height="12.5" rx="2" />
      <path d="M9 7V5.5A1.5 1.5 0 0110.5 4h3A1.5 1.5 0 0115 5.5V7M3.5 12.5h17" />
    </Svg>
  ),
  filhos: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.8 14.2c.8 1.1 1.9 1.7 3.2 1.7s2.4-.6 3.2-1.7M9.3 9.8h.01M14.7 9.8h.01" />
    </Svg>
  ),
  viagens: (p) => (
    <Svg {...p}>
      <path d="M10.5 13.5L3.8 11l1.4-1.4 7.4.7 4.2-4.2a1.8 1.8 0 012.6 2.6l-4.2 4.2.7 7.4-1.4 1.4-2.5-6.7-2.8 2.8.3 2.2-1 1-1.4-3-3-1.4 1-1 2.2.3z" />
    </Svg>
  ),
  saude: (p) => (
    <Svg {...p}>
      <path d="M12 20s-7.5-4.4-7.5-10A4.1 4.1 0 0112 7.6 4.1 4.1 0 0119.5 10c0 5.6-7.5 10-7.5 10z" />
    </Svg>
  ),
  lazer: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </Svg>
  ),
  casa: (p) => (
    <Svg {...p}>
      <path d="M4 11l8-6.5 8 6.5M6 9.5V20h12V9.5M10 20v-5.5h4V20" />
    </Svg>
  ),
  pessoal: (p) => (
    <Svg {...p}>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20c.9-3.9 3.7-6 7.5-6s6.6 2.1 7.5 6" />
    </Svg>
  ),
};

export function CategoryIcon({ category, title }: { category: Category; title?: string }) {
  const C = CAT[category] || CAT.familia;
  return <C title={title} />;
}
