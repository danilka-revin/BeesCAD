import React, { useEffect, useRef, useState } from 'react';
import { IconChevron } from './icons';

/** Выпадающее меню-кнопка в тулбаре: открывается по клику, закрывается при клике снаружи или по выбору пункта. */
export function MenuBtn({
  label,
  icon,
  title,
  align = 'left',
  children,
}: {
  label: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
  align?: 'left' | 'right';
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={'menu-wrap' + (open ? ' open' : '')}>
      <button
        type="button"
        className={'tb-btn' + (open ? ' active' : '')}
        title={title}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span>{label}</span>
        <IconChevron />
      </button>
      {open && (
        <div className={'menu-pop' + (align === 'right' ? ' right' : '')} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Сплит-кнопка: левая часть выполняет основное действие одним кликом, правая стрелка открывает список вариантов. */
export function SplitBtn({
  label,
  icon,
  title,
  disabled,
  primary,
  onClick,
  align = 'left',
  children,
}: {
  label: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
  disabled?: boolean;
  primary?: boolean;
  onClick: () => void;
  align?: 'left' | 'right';
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={'menu-wrap split-wrap' + (open ? ' open' : '')}>
      <button
        type="button"
        className={'tb-btn split-main' + (primary ? ' primary' : '')}
        title={title}
        disabled={disabled}
        onClick={() => {
          setOpen(false);
          onClick();
        }}
      >
        {icon}
        <span>{label}</span>
      </button>
      <button
        type="button"
        className={'tb-btn split-caret' + (primary ? ' primary' : '') + (open ? ' active' : '')}
        title="Другие варианты"
        aria-label="Другие варианты"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <IconChevron />
      </button>
      {open && (
        <div className={'menu-pop' + (align === 'right' ? ' right' : '')} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Сворачиваемая секция боковой панели. Позволяет держать редко нужные блоки закрытыми. */
export function Section({
  title,
  badge,
  defaultOpen = true,
  action,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={'sec' + (open ? ' open' : '')}>
      <header className="sec-head" onClick={() => setOpen((o) => !o)}>
        <span className="sec-arrow">
          <IconChevron />
        </span>
        <span className="sec-title">{title}</span>
        {badge !== undefined && <span className="sec-badge">{badge}</span>}
        {action && (
          <span className="sec-act" onClick={(e) => e.stopPropagation()}>
            {action}
          </span>
        )}
      </header>
      {open && <div className="sec-body">{children}</div>}
    </section>
  );
}
