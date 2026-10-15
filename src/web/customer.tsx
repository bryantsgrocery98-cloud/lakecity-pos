// Customer-facing screen (second monitor). Shows the live ticket, the total, and change due.
import { useEffect, useRef, useState } from 'react';
import { formatCents } from '../core/money';

type Line = { name: string; qty: number; cents: number };
type State = {
  mode: 'idle' | 'ticket' | 'paid'; lines: Line[]; subtotalCents: number; taxCents: number; discountCents: number; totalCents: number;
  tender?: 'cash' | 'card' | 'check'; tenderedCents?: number; changeCents?: number; at: number;
};

export function CustomerDisplay() {
  const [state, setState] = useState<State | null>(null);
  const [store, setStore] = useState({ storeName: '', welcome: 'Welcome!' });
  const [connected, setConnected] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/display/welcome').then((r) => r.json()).then(setStore).catch(() => undefined);
    let es: EventSource | null = null;
    let retry: number | undefined;
    const connect = () => {
      es = new EventSource('/api/display/events');
      es.onopen = () => setConnected(true);
      es.onmessage = (ev) => { try { setState(JSON.parse(ev.data)); } catch { /* ignore */ } };
      es.onerror = () => { setConnected(false); es?.close(); retry = window.setTimeout(connect, 2000); };
    };
    connect();
    // Refresh the welcome text now and then, and reload the page when the register updates.
    let version: string | null = null;
    const t = window.setInterval(() => {
      fetch('/api/display/welcome').then((r) => r.json()).then(setStore).catch(() => undefined);
      fetch('/api/version').then((r) => r.json()).then((v: { version: string }) => {
        if (version === null) version = v.version;
        else if (v.version !== version) window.location.reload();
      }).catch(() => undefined);
    }, 30000);
    return () => { es?.close(); window.clearTimeout(retry); window.clearInterval(t); };
  }, []);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [state?.lines.length]);

  const mode = state?.mode ?? 'idle';

  return (
    <div className="cust">
      <div className="cust-top">
        <div className="cust-brand">{store.storeName || 'Welcome'}</div>
        {!connected && <div className="cust-dot" title="Reconnecting" />}
      </div>

      {mode === 'idle' && (
        <div className="cust-idle">
          <div className="cust-welcome">{store.welcome || 'Welcome!'}</div>
          <div className="cust-sub">Thank you for shopping with us</div>
        </div>
      )}

      {mode === 'ticket' && state && (
        <>
          <div className="cust-lines" ref={listRef}>
            {state.lines.map((l, i) => (
              <div className="cust-line" key={i}>
                <span className="cust-qty">{l.qty > 1 ? `${l.qty} ×` : ''}</span>
                <span className="cust-name">{l.name}</span>
                <span className="cust-amt">{formatCents(l.cents)}</span>
              </div>
            ))}
          </div>
          <div className="cust-totals">
            <div><span>Subtotal</span><span>{formatCents(state.subtotalCents)}</span></div>
            {state.discountCents > 0 && <div><span>Discount</span><span>-{formatCents(state.discountCents)}</span></div>}
            <div><span>Tax</span><span>{formatCents(state.taxCents)}</span></div>
            <div className="cust-total"><span>Total</span><span>{formatCents(state.totalCents)}</span></div>
          </div>
        </>
      )}

      {mode === 'paid' && state && (
        <div className="cust-paid">
          <div className="cust-thanks">Thank you!</div>
          <div className="cust-paidrow"><span>Total</span><span>{formatCents(state.totalCents)}</span></div>
          {state.tender === 'cash' && (
            <>
              <div className="cust-paidrow"><span>Cash</span><span>{formatCents(state.tenderedCents ?? state.totalCents)}</span></div>
              <div className="cust-paidrow cust-change"><span>Change</span><span>{formatCents(state.changeCents ?? 0)}</span></div>
            </>
          )}
          {state.tender === 'card' && <div className="cust-paidrow"><span>Paid by card</span><span>{formatCents(state.totalCents)}</span></div>}
          {state.tender === 'check' && (
            <>
              <div className="cust-paidrow"><span>Check</span><span>{formatCents(state.tenderedCents ?? state.totalCents)}</span></div>
              <div className="cust-paidrow cust-change"><span>Cash to you</span><span>{formatCents(state.changeCents ?? 0)}</span></div>
            </>
          )}
          <div className="cust-sub">Please come again</div>
        </div>
      )}
    </div>
  );
}
