import './Drawer.css';
import type { ReactNode } from 'react';

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  width?: string;
  title: string;
  subTitle?: string;
  children: ReactNode;
};

function DrawerBody({ children }: { children: ReactNode }) {
  return <div className="drawer-body">{children}</div>;
}

function DrawerFooter({ children }: { children: ReactNode }) {
  return <div className="drawer-footer">{children}</div>;
}

const DrawerBase = Object.assign(
  function Drawer({ open, onClose, width = 'min(560px, 96vw)', title, subTitle, children }: DrawerProps) {
    if (!open) return null;
    return (
      <div className="overlay" onClick={onClose}>
        <div className="drawer" style={{ width }} onClick={e => e.stopPropagation()}>
          <div className="drawer-header">
            <div>
              <h2 style={{ marginBottom: subTitle ? 2 : 0 }}>{title}</h2>
              {subTitle && <div className="ds-drawer-sub">{subTitle}</div>}
            </div>
            <button className="btn btn-secondary btn-sm" type="button" onClick={onClose} aria-label="Fechar">
              ✕
            </button>
          </div>
          {children}
        </div>
      </div>
    );
  },
  { Body: DrawerBody, Footer: DrawerFooter },
);

export const Drawer = DrawerBase;
