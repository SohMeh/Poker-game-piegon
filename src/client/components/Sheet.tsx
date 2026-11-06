import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconClose } from './Icons';

export function Sheet({
  title,
  onClose,
  children,
  tall,
  className,
  headExtra,
  hideTitle,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  tall?: boolean;
  className?: string;
  headExtra?: ReactNode;
  hideTitle?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        className={`sheet ${tall ? 'is-tall' : ''} ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
      >
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-head">
          <h2 className={`sheet-title ${hideTitle ? 'sr-only' : ''}`} id={id}>
            {title}
          </h2>
          {headExtra}
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
