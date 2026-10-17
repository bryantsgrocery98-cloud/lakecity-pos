import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ButtonShape } from '../core/types';

/** Shape icons shown on every one-click tile. */
export function Shape({ shape, size = 36 }: { shape: ButtonShape; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
  switch (shape) {
    case 'can': return <svg {...p}><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M7 8h10M7 16h10" /></svg>;
    case 'six': return <svg {...p}><rect x="3" y="4" width="5" height="7" rx="1" /><rect x="9.5" y="4" width="5" height="7" rx="1" /><rect x="16" y="4" width="5" height="7" rx="1" /><rect x="3" y="13" width="5" height="7" rx="1" /><rect x="9.5" y="13" width="5" height="7" rx="1" /><rect x="16" y="13" width="5" height="7" rx="1" /></svg>;
    case 'twelve': return <svg {...p}><rect x="2" y="5" width="20" height="14" rx="2" />{[7, 12, 17].flatMap((x) => [9.5, 14.5].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.3" />))}</svg>;
    case 'eighteen': return <svg {...p}><rect x="1.5" y="4" width="21" height="16" rx="2" />{[5.5, 9.5, 13.5, 17.5].flatMap((x) => [8.5, 12, 15.5].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1" />))}</svg>;
    case 'bag': return <svg {...p}><path d="M6 8h12l1 12H5z" /><path d="M9 8a3 3 0 0 1 6 0" /></svg>;
    case 'cup': return <svg {...p}><path d="M6 4h12l-1.5 16h-9z" /><path d="M6.5 9h11" /></svg>;
    default: return <svg {...p}><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4" /><path d="M12 11v10" /></svg>;
  }
}

export function Icon({ name, size = 24 }: { name: string; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
  switch (name) {
    case 'search': return <svg {...p}><circle cx="11" cy="11" r="6" /><path d="M16 16l5 5" /></svg>;
    case 'keyboard': return <svg {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></svg>;
    case 'hold': return <svg {...p}><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>;
    case 'recall': return <svg {...p}><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>;
    case 'drawer': return <svg {...p}><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M6 13l1.5-6h9L18 13" /></svg>;
    case 'discount': return <svg {...p}><path d="M19 5L5 19" /><circle cx="7" cy="7" r="2" /><circle cx="17" cy="17" r="2" /></svg>;
    case 'sound': return <svg {...p}><path d="M4 10v4h4l5 4V6l-5 4z" /><path d="M16 9a4 4 0 0 1 0 6" /><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" /></svg>;
    case 'mute': return <svg {...p}><path d="M4 10v4h4l5 4V6l-5 4z" /><path d="M17 9l4 6M21 9l-4 6" /></svg>;
    case 'upload': return <svg {...p}><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 20h16" /></svg>;
    case 'settings': return <svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>;
    case 'plus': return <svg {...p}><path d="M12 5v14M5 12h14" /></svg>;
    case 'edit': return <svg {...p}><path d="M4 20h4l10-10-4-4L4 16z" /><path d="M13 7l4 4" /></svg>;
    case 'image': return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M21 16l-5-5-8 8" /></svg>;
    case 'box': return <svg {...p}><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4" /><path d="M12 11v10" /></svg>;
    case 'report': return <svg {...p}><path d="M5 20V10M12 20V4M19 20v-7" /></svg>;
    case 'lock': return <svg {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
    case 'id': return <svg {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><circle cx="8" cy="11" r="2" /><path d="M5 16c.6-1.6 2-2.4 3-2.4s2.4.8 3 2.4M14 10h5M14 14h4" /></svg>;
    case 'ticket': return <svg {...p}><path d="M4 6h16v3.5a2.5 2.5 0 0 0 0 5V18H4v-3.5a2.5 2.5 0 0 0 0-5z" /></svg>;
    case 'card': return <svg {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 15h4" /></svg>;
    case 'power': return <svg {...p}><path d="M12 3v9" /><path d="M6.3 6.3a8 8 0 1 0 11.4 0" /></svg>;
    case 'gas': return <svg {...p}><path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16" /><path d="M3 21h14" /><path d="M15 9h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9l-3-3" /><rect x="7" y="6" width="6" height="4" rx="1" /></svg>;
    case 'check': return <svg {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>;
    case 'tag': return <svg {...p}><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.2" /></svg>;
    case 'payout': return <svg {...p}><path d="M12 3v12" /><path d="M8 11l4 4 4-4" /><path d="M4 19h16" /></svg>;
    case 'ok': return <svg {...p} strokeWidth={2.4}><path d="M5 12.5l4.5 4.5L19 7" /></svg>;
    case 'ban': return <svg {...p} strokeWidth={2.2}><circle cx="12" cy="12" r="10" /><path d="M5 5l14 14" /></svg>;
    default: return <svg {...p}><circle cx="12" cy="12" r="9" /></svg>;
  }
}

/** On-screen number pad. Reports keys: 0-9, "00", "back", "clear". */
export function Keypad({ onKey, onEnter, doubleZero = false }: { onKey: (k: string) => void; onEnter?: () => void; doubleZero?: boolean }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
  // A real keyboard works too: digits, Backspace, Escape (clear) and Enter.
  const latest = useRef({ onKey, onEnter });
  latest.current = { onKey, onEnter };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return; // a text box has the keyboard
      if (/^[0-9]$/.test(e.key)) latest.current.onKey(e.key);
      else if (e.key === 'Backspace') latest.current.onKey('back');
      else if (e.key === 'Escape') latest.current.onKey('clear');
      else if (e.key === 'Enter') latest.current.onEnter?.();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return (
    <div className="keypad">
      {keys.map((k) => (
        <button key={k} className={`key ${k === 'clear' || k === 'back' ? 'key-fn' : ''}`} onClick={() => onKey(k)}
          aria-label={k === 'back' ? 'Delete' : k === 'clear' ? 'Clear' : k}>
          {k === 'back' ? '⌫' : k === 'clear' ? 'Clear' : k}
        </button>
      ))}
      {doubleZero && <button className="key key-wide" onClick={() => onKey('00')}>00</button>}
    </div>
  );
}

const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

/** On-screen keyboard for names and search, so the Windows keyboard never has to pop up. */
export function OnScreenKeyboard({ onChar, onBack, onClear, onDone }: {
  onChar: (c: string) => void; onBack: () => void; onClear: () => void; onDone?: () => void;
}) {
  const [shift, setShift] = useState(false);
  const press = (c: string) => { onChar(shift ? c.toUpperCase() : c); setShift(false); };
  return (
    <div className="osk">
      {ROWS.map((row) => (
        <div key={row} className="osk-row">
          {row.split('').map((c) => <button key={c} className="osk-key" onClick={() => press(c)}>{shift ? c.toUpperCase() : c}</button>)}
        </div>
      ))}
      <div className="osk-row">
        <button className={`osk-key osk-fn ${shift ? 'on' : ''}`} onClick={() => setShift(!shift)}>Shift</button>
        {'0123456789'.split('').map((c) => <button key={c} className="osk-key" onClick={() => onChar(c)}>{c}</button>)}
        <button className="osk-key osk-fn" onClick={onBack} aria-label="Delete">⌫</button>
      </div>
      <div className="osk-row">
        <button className="osk-key osk-fn" onClick={onClear}>Clear</button>
        <button className="osk-key osk-space" onClick={() => onChar(' ')}>space</button>
        <button className="osk-key osk-fn" onClick={() => onChar('-')}>-</button>
        {onDone && <button className="osk-key osk-fn osk-done" onClick={onDone}>Done</button>}
      </div>
    </div>
  );
}

export function Modal({ title, children, onClose, wide, footer }: { title: string; children: ReactNode; onClose?: () => void; wide?: boolean; footer?: ReactNode }) {
  // With a footer, the body scrolls and the footer (the confirm button) stays pinned at the bottom of the pop-up.
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`modal ${wide ? 'modal-wide' : ''} ${footer ? 'modal-pinned' : ''}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && <button className="btn btn-quiet" onClick={onClose}>Close</button>}
        </div>
        {footer ? <div className="modal-body">{children}</div> : children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Lets a real keyboard type into an on-screen text field (one that is not a browser input). */
export function useTypedText(opts: { onChar: (c: string) => void; onBack: () => void; onEnter?: () => void; allowDigits?: boolean; enabled?: boolean }) {
  const latest = useRef(opts);
  latest.current = opts;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const o = latest.current;
      if (o.enabled === false || e.ctrlKey || e.metaKey || e.altKey) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
      if (e.key.length === 1) {
        if (/^[0-9]$/.test(e.key) && !o.allowDigits) return; // digits belong to the keypad on this screen
        o.onChar(e.key);
      } else if (e.key === 'Backspace') o.onBack();
      else if (e.key === 'Enter' && o.onEnter) o.onEnter();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
}
