import type { ReactNode, SVGProps } from 'react';

/** Small stroke icons (24 x 24 grid), drawn inline so nothing loads from the network. */
function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement>;

export const TvIcon = (p: P) => (
  <Icon {...p}>
    <rect x="2.5" y="4" width="19" height="12.5" rx="1.5" />
    <path d="M8 20h8M12 16.5V20" />
  </Icon>
);

export const ChairIcon = (p: P) => (
  <Icon {...p}>
    <path d="M7 3v9M17 3v9M7 6h10" />
    <rect x="5" y="12" width="14" height="3" rx="1" />
    <path d="M6.5 15 6 21M17.5 15l.5 6" />
  </Icon>
);

export const TableIcon = (p: P) => (
  <Icon {...p}>
    <rect x="2.5" y="7" width="19" height="3" rx="1" />
    <path d="M5 10v10M19 10v10M8 10v3h8v-3" />
  </Icon>
);

export const InfoIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
);

export const CloseIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const UndoIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Icon>
);

export const TrashIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);

export const CopyIcon = (p: P) => (
  <Icon {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </Icon>
);

export const RotateLeftIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 4v5h5" />
    <path d="M3.5 13a8.5 8.5 0 1 0 2-7L3 9" />
  </Icon>
);

export const RotateRightIcon = (p: P) => (
  <Icon {...p}>
    <path d="M21 4v5h-5" />
    <path d="M20.5 13a8.5 8.5 0 1 1-2-7L21 9" />
  </Icon>
);

export const PlusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const MinusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
);

export const ArrowUpIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);

export const ArrowDownIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);

export const ArrowLeftIcon = (p: P) => (
  <Icon {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);

export const ArrowRightIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

/** Towards the user. */
export const CloserIcon = (p: P) => (
  <Icon {...p}>
    <rect x="8" y="8" width="8" height="8" rx="1" />
    <path d="M3 3l4 4M21 3l-4 4M3 21l4-4M21 21l-4-4" />
  </Icon>
);

/** Away from the user. */
export const FartherIcon = (p: P) => (
  <Icon {...p}>
    <rect x="10" y="10" width="4" height="4" rx="0.5" />
    <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 3" />
  </Icon>
);

export const FaceIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
  </Icon>
);

export const HandIcon = (p: P) => (
  <Icon {...p}>
    <path d="M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15" />
  </Icon>
);

export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 12.5 10 17 19 7" />
  </Icon>
);

export const PhoneIcon = (p: P) => (
  <Icon {...p}>
    <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </Icon>
);

export const AlertIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3 2 20h20L12 3z" />
    <path d="M12 10v4M12 17h.01" />
  </Icon>
);

export const RestoreIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <circle cx="12" cy="12" r="4" />
  </Icon>
);
