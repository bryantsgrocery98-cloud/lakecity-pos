import { useEffect, useState } from 'react';
import { centsFromKeypadDigits, formatCents } from '../core/money';
import type { CustomerDto } from '../core/types';
import { TabPaymentModal } from './modals';
import { api } from './api';
import { Icon, Keypad, Modal, OnScreenKeyboard, useTypedText } from './parts';
import { play } from './sounds';

type SaleRow = {
  receiptNo: string; createdAt: string; cashier: string; totalCents: number; voided: boolean; voidReason: string | null; tender: string; refundedCents: number;
  lines: { id: number; name: string; qty: number; unitCents: number; grossCents: number; discountCents: number; taxCents: number; category: string; refundedQty: number }[];
};
type DayReport = {
  title: string; workday: string; closed: { closed_at: string; cashier: string } | null;
  sales: { count: number; subtotal: number; discount: number; tax: number; total: number };
  voids: { count: number; total: number }; refunds: { count: number; total: number };
  byCategory: { category: string; qty: number; cents: number }[]; byAuthority: { title: string; cents: number }[];
  tenders: { tender: string; cents: number; count: number }[]; lottery: { sales: number; payouts: number }; noSales: number;
  checks?: { count: number; tendered: number; cashOut: number };
  tabs?: { charged: number; chargedCount: number; payments: { tender: string; cents: number; count: number }[]; paymentsTotal: number; owedTotal: number };
  items: { name: string; qty: number; cents: number }[];
};
type PrinterCfg = { target: string; printReceipts: boolean; drawerKick: boolean; available: string[]; drawerPort: string; serialPorts: { port: string; name: string }[]; storeName: string; header: string; footer: string; showCashier: boolean };

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function ManagePage({ pin, cashier, version, onClose }: { pin: string; cashier: string; version: string; onClose: () => void }) {
  const [tab, setTab] = useState<'sales' | 'day' | 'customers' | 'printer' | 'settings' | 'updates'>('sales');
  return (
    <div className="inv">
      <header className="topbar">
        <div><span className="brand">Manage</span><span className="sub">v{version}</span></div>
        <div className="topbar-right">
          <button className="btn btn-sm btn-primary" onClick={onClose}>Back to register</button>
        </div>
      </header>
      <div className="inv-filters" style={{ paddingTop: 12 }}>
        <button className={`btn ${tab === 'sales' ? 'btn-dark' : ''}`} onClick={() => setTab('sales')}>Sales, voids, refunds</button>
        <button className={`btn ${tab === 'day' ? 'btn-dark' : ''}`} onClick={() => setTab('day')}>Day report (X / Z)</button>
        <button className={`btn ${tab === 'customers' ? 'btn-dark' : ''}`} onClick={() => setTab('customers')}>Customer tabs</button>
        <button className={`btn ${tab === 'printer' ? 'btn-dark' : ''}`} onClick={() => setTab('printer')}>Printer</button>
        <button className={`btn ${tab === 'settings' ? 'btn-dark' : ''}`} onClick={() => setTab('settings')}>Settings &amp; Tax</button>
        <button className={`btn ${tab === 'updates' ? 'btn-dark' : ''}`} onClick={() => setTab('updates')}>Updates</button>
      </div>
      <div className="inv-body" style={{ display: 'block', overflowY: 'auto' }}>
        {tab === 'sales' && <SalesTab pin={pin} cashier={cashier} />}
        {tab === 'day' && <DayTab pin={pin} cashier={cashier} />}
        {tab === 'customers' && <CustomersTab pin={pin} cashier={cashier} />}
        {tab === 'printer' && <PrinterTab pin={pin} />}
        {tab === 'settings' && <SettingsTab pin={pin} cashier={cashier} />}
        {tab === 'updates' && <UpdatesTab cashier={cashier} version={version} />}
      </div>
    </div>
  );
}

// ---------- sales ----------

function SalesTab({ pin, cashier }: { pin: string; cashier: string }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [sel, setSel] = useState<SaleRow | null>(null);
  const [mode, setMode] = useState<null | 'void' | 'refund'>(null);
  const [msg, setMsg] = useState('');
  const load = () => api<SaleRow[]>(`/api/sales?q=${encodeURIComponent(q)}`).then(setRows).catch((e: Error) => setMsg(e.message));
  useEffect(() => { load(); }, [q]);

  const reprint = async (r: SaleRow) => {
    try { await api(`/api/sales/${r.receiptNo}/print`, {}); setMsg(`Receipt ${r.receiptNo} sent to the printer.`); }
    catch (e) { setMsg((e as Error).message); }
  };

  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="inv-tools" style={{ padding: 0, marginBottom: 10 }}>
          <div className="search" style={{ flex: 1 }}>
            <Icon name="search" size={22} />
            <input value={q} onChange={(e) => setQ(e.target.value)} inputMode="numeric" placeholder="Receipt number (today's sales shown by default)" aria-label="Receipt search" />
            {q && <button className="btn btn-quiet btn-sm" onClick={() => setQ('')}>Clear</button>}
          </div>
        </div>
        {msg && <div className="inv-msg" style={{ margin: '0 0 10px' }}>{msg}</div>}
        <div className="items-scroll" style={{ maxHeight: '64vh' }}>
          <table className="rep items-table">
            <thead><tr><th>Receipt</th><th>Time</th><th>Cashier</th><th>Paid</th><th className="num">Total</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.receiptNo} className={sel?.receiptNo === r.receiptNo ? 'sel' : ''} onClick={() => { setSel(r); setMode(null); }}>
                  <td><b>{r.receiptNo}</b></td><td>{when(r.createdAt)}</td><td>{r.cashier}</td><td>{r.tender === 'cash' ? 'Cash' : 'Card'}</td>
                  <td className="num">{formatCents(r.totalCents)}</td>
                  <td>{r.voided ? <span className="tag" style={{ background: '#ffd9d6', color: '#6b1410' }}>VOIDED</span> : r.refundedCents > 0 ? <span className="tag" style={{ background: '#fff6d9', color: '#4a2f00' }}>refunded {formatCents(r.refundedCents)}</span> : ''}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="hint">No sales found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <aside className="inv-edit" style={{ width: 420 }}>
        {!sel ? <div className="inv-empty"><Icon name="report" size={44} /><p>Tap a sale to see it, reprint it, void it, or refund part of it.</p></div> : (
          <div className="editor">
            <div className="editor-head"><h2>{sel.receiptNo}</h2><button className="btn btn-quiet btn-sm" onClick={() => setSel(null)}>Close</button></div>
            <div className="hint">{when(sel.createdAt)} · {sel.cashier} · {sel.tender === 'cash' ? 'Cash' : 'Card'}</div>
            {sel.voided && <div className="err">Voided: {sel.voidReason}</div>}
            <table className="rep"><tbody>
              {sel.lines.map((l) => <tr key={l.id}><td>{l.qty} × {l.name}{l.refundedQty > 0 && <span className="hint"> ({l.refundedQty} refunded)</span>}</td><td className="num">{formatCents(l.grossCents - l.discountCents)}</td></tr>)}
              <tr><td><b>Total with tax</b></td><td className="num"><b>{formatCents(sel.totalCents)}</b></td></tr>
            </tbody></table>
            <div className="quick" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
              <button className="btn" onClick={() => reprint(sel)}>Reprint</button>
              <button className="btn btn-danger" disabled={sel.voided || sel.refundedCents > 0} onClick={() => setMode('void')}>Void sale</button>
              <button className="btn" disabled={sel.voided} onClick={() => setMode('refund')}>Refund…</button>
            </div>
            <div className="hint">Void = the whole sale was a mistake (same day only). Refund = the customer brought something back or was overcharged.</div>
          </div>
        )}
      </aside>
      {sel && mode === 'void' && <ReasonModal title={`Void ${sel.receiptNo}`} hint="The sale stays in the records marked as voided. Stock goes back." onClose={() => setMode(null)}
        onOk={async (reason) => { try { await api(`/api/sales/${sel.receiptNo}/void`, { pin, cashier, reason }); play('done'); setMsg(`${sel.receiptNo} voided.`); setMode(null); setSel(null); load(); } catch (e) { setMsg((e as Error).message); play('bad'); setMode(null); } }} />}
      {sel && mode === 'refund' && <RefundModal sale={sel} pin={pin} cashier={cashier} onClose={() => setMode(null)}
        onDone={(m) => { setMsg(m); setMode(null); setSel(null); load(); }} />}
    </div>
  );
}

function ReasonModal({ title, hint, onClose, onOk }: { title: string; hint: string; onClose: () => void; onOk: (reason: string) => void }) {
  const [v, setV] = useState('');
  const presets = ['Rang wrong item', 'Wrong price', 'Customer changed mind', 'Duplicate sale', 'Test sale'];
  return (
    <Modal title={title} onClose={onClose}>
      <div className="hint">{hint}</div>
      <div className="chips">{presets.map((p) => <button key={p} className={`chip ${v === p ? 'on' : ''}`} onClick={() => setV(p)}>{p}</button>)}</div>
      <div className="display plain" style={{ fontSize: 20, justifyContent: 'flex-start' }}>{v || <span className="hint">Reason</span>}</div>
      <OnScreenKeyboard onChar={(c) => setV((s) => s + c)} onBack={() => setV((s) => s.slice(0, -1))} onClear={() => setV('')} />
      <button className="btn btn-primary btn-block" style={{ minHeight: 58 }} disabled={!v.trim()} onClick={() => onOk(v.trim())}>Confirm</button>
    </Modal>
  );
}

function RefundModal({ sale, pin, cashier, onClose, onDone }: { sale: SaleRow; pin: string; cashier: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [qty, setQty] = useState<Record<number, number>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const presets = ['Returned item', 'Overcharged', 'Damaged product', 'Wrong item given'];
  const total = sale.lines.reduce((s, l) => { const q = qty[l.id] ?? 0; return s + Math.round((l.grossCents - l.discountCents + l.taxCents) * q / l.qty); }, 0);
  const submit = async () => {
    const lines = Object.entries(qty).filter(([, q]) => q > 0).map(([id, q]) => ({ id: Number(id), qty: q }));
    if (!lines.length) { setError('Pick what is being refunded.'); return; }
    if (!reason.trim()) { setError('Give a reason.'); return; }
    try {
      const r = await api<{ totalCents: number; tender: string }>(`/api/sales/${sale.receiptNo}/refund`, { pin, cashier, reason: reason.trim(), lines });
      play('done');
      onDone(`Refunded ${formatCents(r.totalCents)} ${r.tender === 'cash' ? 'in cash (drawer opened)' : 'to be returned to the card'} on ${sale.receiptNo}.`);
    } catch (e) { setError((e as Error).message); play('bad'); }
  };
  return (
    <Modal title={`Refund from ${sale.receiptNo}`} onClose={onClose} wide>
      <table className="rep"><tbody>
        {sale.lines.map((l) => {
          const left = l.qty - l.refundedQty; const q = qty[l.id] ?? 0;
          return (
            <tr key={l.id}>
              <td>{l.name}<div className="hint">{left} of {l.qty} can be refunded · {formatCents(l.unitCents)} each</div></td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>
                <button className="btn tool" aria-label="Less" disabled={q <= 0} onClick={() => setQty({ ...qty, [l.id]: q - 1 })}>−</button>
                <b style={{ display: 'inline-block', minWidth: 36, textAlign: 'center', fontSize: 20 }}>{q}</b>
                <button className="btn tool" aria-label="More" disabled={q >= left} onClick={() => setQty({ ...qty, [l.id]: q + 1 })}>+</button>
              </td>
            </tr>
          );
        })}
      </tbody></table>
      <div className="chips">{presets.map((p) => <button key={p} className={`chip ${reason === p ? 'on' : ''}`} onClick={() => setReason(p)}>{p}</button>)}</div>
      <div className="display plain" style={{ fontSize: 18, justifyContent: 'flex-start' }}>{reason || <span className="hint">Reason</span>}</div>
      <OnScreenKeyboard onChar={(c) => setReason((s) => s + c)} onBack={() => setReason((s) => s.slice(0, -1))} onClear={() => setReason('')} />
      <div className="change"><span>Refund (with tax)</span><span className="num">{formatCents(total)}</span></div>
      {error && <div className="err">{error}</div>}
      <button className="btn btn-primary btn-block" style={{ minHeight: 60, fontSize: 20 }} onClick={submit}>Refund {formatCents(total)} {sale.tender === 'cash' ? 'cash' : 'to card'}</button>
    </Modal>
  );
}

// ---------- day report ----------

function DayTab({ pin, cashier }: { pin: string; cashier: string }) {
  const [r, setR] = useState<DayReport | null>(null);
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => api<DayReport>(`/api/reports/day?cashier=${encodeURIComponent(cashier)}`).then(setR).catch((e: Error) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const print = async (items: boolean) => {
    setBusy(true);
    try { await api('/api/reports/print', { cashier, items }); setMsg('Report sent to the printer.'); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const closeDay = async () => {
    setBusy(true); setConfirm(false);
    try {
      const res = await api<{ printed: boolean; printError: string }>('/api/reports/z', { pin, cashier, print: true });
      play('done'); setMsg(res.printed ? 'Day closed and Z report printed.' : `Day closed.${res.printError ? ` Printing failed: ${res.printError}` : ''}`); load();
    } catch (e) { setMsg((e as Error).message); play('bad'); } finally { setBusy(false); }
  };
  if (!r) return <div className="hint">Loading…</div>;
  const Row = ({ l, v, b }: { l: string; v: string; b?: boolean }) => <tr><td>{b ? <b>{l}</b> : l}</td><td className="num">{b ? <b>{v}</b> : v}</td></tr>;
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
        <div className="field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <span className="field-label">{r.title} · {r.workday}{r.closed ? ` · closed ${when(r.closed.closed_at)} by ${r.closed.cashier}` : ''}</span>
          <table className="rep"><tbody>
            <Row l="Tickets" v={String(r.sales.count)} />
            <Row l="Subtotal" v={formatCents(r.sales.subtotal)} />
            {r.sales.discount > 0 && <Row l="Discounts" v={`-${formatCents(r.sales.discount)}`} />}
            <Row l="Tax" v={formatCents(r.sales.tax)} />
            <Row l="Total taken" v={formatCents(r.sales.total)} b />
            {r.voids.count > 0 && <Row l={`Voided (${r.voids.count})`} v={`-${formatCents(r.voids.total)}`} />}
            {r.refunds.count > 0 && <Row l={`Refunds (${r.refunds.count})`} v={`-${formatCents(r.refunds.total)}`} />}
          </tbody></table>
        </div>
        <div className="field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <span className="field-label">TENDERS AND DRAWER</span>
          <table className="rep"><tbody>
            {r.tenders.map((t) => <Row key={t.tender} l={`${t.tender} (${t.count})`} v={formatCents(t.cents)} />)}
            <Row l="Lottery sales" v={formatCents(r.lottery.sales)} />
            <Row l="Lottery payouts" v={`-${formatCents(r.lottery.payouts)}`} />
            {r.checks && r.checks.count > 0 && <>
              <Row l={`Checks cashed (${r.checks.count})`} v={formatCents(r.checks.tendered)} />
              <Row l="Cash paid out for checks" v={`-${formatCents(r.checks.cashOut)}`} />
            </>}
            {r.tabs && (r.tabs.chargedCount > 0 || r.tabs.paymentsTotal > 0) && <>
              <Row l={`Charged to tabs (${r.tabs.chargedCount})`} v={formatCents(r.tabs.charged)} />
              {r.tabs.payments.map((t) => <Row key={t.tender} l={`Tab payments by ${t.tender} (${t.count})`} v={`+${formatCents(t.cents)}`} />)}
              <Row l="All tabs owed now" v={formatCents(r.tabs.owedTotal)} />
            </>}
            <Row l="No Sale opens" v={String(r.noSales)} />
          </tbody></table>
        </div>
        <div className="field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <span className="field-label">BY DEPARTMENT (BEFORE TAX)</span>
          <table className="rep"><tbody>{r.byCategory.map((c) => <Row key={c.category} l={`${c.category} (${c.qty})`} v={formatCents(c.cents)} />)}</tbody></table>
        </div>
        <div className="field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <span className="field-label">TAX BY AUTHORITY</span>
          <table className="rep"><tbody>{r.byAuthority.map((a) => <Row key={a.title} l={a.title} v={formatCents(a.cents)} />)}</tbody></table>
          <div className="hint">For filing prep only. Verify rates with SC DOR.</div>
        </div>
        <div className="field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, gridColumn: '1 / -1' }}>
          <span className="field-label">ITEMS SOLD ({r.items.length})</span>
          <div className="items-scroll" style={{ maxHeight: 240 }}>
            <table className="rep"><tbody>{r.items.map((i) => <Row key={i.name} l={`${i.qty} × ${i.name}`} v={formatCents(i.cents)} />)}</tbody></table>
          </div>
        </div>
      </div>
      <aside className="inv-edit" style={{ width: 320, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {msg && <div className="inv-msg" style={{ margin: 0 }}>{msg}</div>}
        <button className="btn btn-block" disabled={busy} onClick={() => print(false)}>Print X report</button>
        <button className="btn btn-block" disabled={busy} onClick={() => print(true)}>Print with items sold</button>
        <div className="hint">An X report shows the day so far without closing it.</div>
        <button className="btn btn-primary btn-block" style={{ minHeight: 64, fontSize: 20 }} disabled={busy || !!r.closed} onClick={() => setConfirm(true)}>{r.closed ? 'Day already closed' : 'Close day (Z report)'}</button>
        <div className="hint">Closing prints the Z report and locks today's sales from being voided. Refunds still work afterwards.</div>
        <button className="btn btn-block btn-quiet" onClick={load}>Refresh</button>
      </aside>
      {confirm && (
        <Modal title="Close the day?" onClose={() => setConfirm(false)}>
          <div className="hint">This prints the Z report for {r.workday} and locks its sales. Do this once at the end of the day.</div>
          <button className="btn btn-primary btn-block" style={{ minHeight: 60 }} onClick={closeDay}>Yes, close the day</button>
          <button className="btn btn-block" onClick={() => setConfirm(false)}>Not yet</button>
        </Modal>
      )}
    </div>
  );
}

// ---------- printer ----------

function PrinterTab({ pin }: { pin: string }) {
  const [cfg, setCfg] = useState<PrinterCfg | null>(null);
  const [target, setTarget] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [kb, setKb] = useState(false);
  useEffect(() => { api<PrinterCfg>('/api/printer').then((c) => { setCfg(c); setTarget(c.target); }).catch((e: Error) => setMsg(e.message)); }, []);
  if (!cfg) return <div className="hint">Loading…</div>;
  const save = async (patch: Partial<PrinterCfg>) => {
    try { await api('/api/printer', { pin, ...patch }); setCfg({ ...cfg, ...patch }); setMsg('Saved.'); } catch (e) { setMsg((e as Error).message); throw e; }
  };
  const toggle = (patch: Partial<PrinterCfg>) => { save(patch).catch(() => {}); };
  const test = async () => {
    setBusy(true); setMsg('');
    try { await api('/api/printer/test', { target }); setMsg('Test page sent. Check the printer.'); play('done'); } catch (e) { setMsg((e as Error).message); play('bad'); } finally { setBusy(false); }
  };
  const drawer = async () => {
    setMsg('');
    try { await api('/api/printer/drawer', { pin }); setMsg('Open signal sent to the register.'); play('done'); } catch (e) { setMsg((e as Error).message); play('bad'); }
  };
  const canOpen = !!cfg.target || !!cfg.drawerPort;
  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {msg && <div className="inv-msg" style={{ margin: 0 }}>{msg}</div>}
      <div className="editor-label">PRINTER</div>
      {cfg.available.length > 0 && (
        <div className="chips">{cfg.available.map((n) => <button key={n} className={`chip ${target === n ? 'on' : ''}`} onClick={() => setTarget(n)}>{n}</button>)}</div>
      )}
      <div className="quick" style={{ gridTemplateColumns: '1fr auto' }}>
        <div className="field" style={{ minHeight: 52 }}><span className="field-value" style={{ fontWeight: 500 }}>{target || <span className="hint">Pick a printer above, or type its Windows name</span>}</span></div>
        <button className="btn" onClick={() => setKb(!kb)}><Icon name="keyboard" size={20} /></button>
      </div>
      {kb && <OnScreenKeyboard onChar={(c) => setTarget((s) => s + c)} onBack={() => setTarget((s) => s.slice(0, -1))} onClear={() => setTarget('')} onDone={() => setKb(false)} />}
      <div className="quick" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <button className="btn btn-primary" disabled={busy || !target} onClick={test}>Print test page</button>
        <button className="btn" disabled={target === cfg.target} onClick={() => toggle({ target })}>Save printer</button>
        <button className="btn" disabled={!canOpen} onClick={drawer}>Open register now</button>
      </div>
      <div className="hint">For a network printer type <b>tcp://</b> and its address, like tcp://192.168.1.50.</div>
      <div className="editor-label">CASH DRAWER</div>
      <div className="chips">
        <button className={`chip ${!cfg.drawerPort ? 'on' : ''}`} onClick={() => toggle({ drawerPort: '' })}>Plugged into the printer</button>
        {cfg.serialPorts.map((sp) => <button key={sp.port} className={`chip ${cfg.drawerPort === sp.port ? 'on' : ''}`} onClick={() => toggle({ drawerPort: sp.port })}>USB: {sp.name}</button>)}
      </div>
      <div className="hint">A drawer with a phone-style cable plugs into the printer. A drawer with a USB cable shows up here as a COM port; pick it, then press <b>Open register now</b> to test.{cfg.serialPorts.length === 0 && ' (No USB drawer found right now; check its cable and come back to this tab.)'}</div>
      <div className="editor-label">AFTER EACH SALE</div>
      <div className="chips">
        <button className={`chip ${cfg.printReceipts ? 'on' : ''}`} onClick={() => toggle({ printReceipts: !cfg.printReceipts })}>Print a receipt automatically: {cfg.printReceipts ? 'ON' : 'OFF'}</button>
        <button className={`chip ${cfg.drawerKick ? 'on' : ''}`} onClick={() => toggle({ drawerKick: !cfg.drawerKick })}>Open register on cash sales: {cfg.drawerKick ? 'ON' : 'OFF'}</button>
      </div>
      <div className="hint">With automatic receipts off, the cashier can still print one from the Sale Complete screen or reprint it later from the Sales tab.</div>
      <CustomerScreenSettings pin={pin} />
      <div className="editor-label">RECEIPT TEXT</div>
      <TextSetting label="Store name (big, top line)" value={cfg.storeName} onSave={(v) => save({ storeName: v })} />
      <TextSetting label="Header lines (address, phone…)" value={cfg.header} multiline onSave={(v) => save({ header: v })} />
      <TextSetting label="Footer lines (thank you, return policy…)" value={cfg.footer} multiline onSave={(v) => save({ footer: v })} />
      <div className="chips">
        <button className={`chip ${cfg.showCashier ? 'on' : ''}`} onClick={() => toggle({ showCashier: !cfg.showCashier })}>Show cashier name on receipt: {cfg.showCashier ? 'ON' : 'OFF'}</button>
      </div>
      <div className="hint">The receipt always shows the receipt number, date, items, subtotal, each tax, total, and how it was paid.</div>
    </div>
  );
}

function TextSetting({ label, value, multiline, onSave }: { label: string; value: string; multiline?: boolean; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(value);
  const [kb, setKb] = useState(false);
  const [state, setState] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  useEffect(() => setV(value), [value]);
  const save = async () => {
    setState(null);
    try { await onSave(v); setState({ kind: 'ok', text: 'Saved' }); play('done'); }
    catch (e) { setState({ kind: 'err', text: (e as Error).message }); play('bad'); }
  };
  return (
    <div className="field" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <span className="field-label">{label}</span>
      {multiline
        ? <textarea value={v} onChange={(e) => setV(e.target.value)} rows={3} style={{ font: 'inherit', fontSize: 17, border: '1px solid var(--line-2)', borderRadius: 10, padding: 8, resize: 'vertical' }} />
        : <input value={v} onChange={(e) => setV(e.target.value)} style={{ font: 'inherit', fontSize: 18, border: '1px solid var(--line-2)', borderRadius: 10, padding: 8 }} />}
      {kb && <OnScreenKeyboard onChar={(c) => setV((s) => s + c)} onBack={() => setV((s) => s.slice(0, -1))} onClear={() => setV('')} onDone={() => setKb(false)} />}
      <div className="quick" style={{ gridTemplateColumns: 'auto auto 1fr' }}>
        <button className="btn btn-sm" onClick={() => setKb(!kb)}><Icon name="keyboard" size={18} /></button>
        <button className="btn btn-sm btn-primary" onClick={save}>Save</button>
        <span style={{ alignSelf: 'center', color: state?.kind === 'err' ? 'var(--bad, #c0392b)' : 'var(--good, #1c7c4a)', fontWeight: 600 }}>
          {state?.text ?? (v !== value ? 'Not saved yet' : '')}
        </span>
      </div>
    </div>
  );
}

type DisplayCfg = { enabled: boolean; welcome: string; screens: { width: number; height: number; primary: boolean }[]; viewers: number };

function CustomerScreenSettings({ pin }: { pin: string }) {
  const [cfg, setCfg] = useState<DisplayCfg | null>(null);
  const [msg, setMsg] = useState('');
  const load = () => api<DisplayCfg>('/api/display/settings').then(setCfg).catch((e: Error) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  if (!cfg) return null;
  const save = async (patch: Partial<DisplayCfg>) => {
    try { await api('/api/display/settings', { pin, ...patch }); setCfg({ ...cfg, ...patch }); setMsg('Saved.'); } catch (e) { setMsg((e as Error).message); throw e; }
  };
  const open = async () => {
    try { const r = await api<{ message: string }>('/api/display/open', { force: true }); setMsg(r.message); setTimeout(load, 3000); } catch (e) { setMsg((e as Error).message); }
  };
  const second = cfg.screens.filter((sc) => !sc.primary);
  return (
    <>
      <div className="editor-label">CUSTOMER SCREEN</div>
      {msg && <div className="inv-msg" style={{ margin: 0 }}>{msg}</div>}
      <div className="chips">
        <button className={`chip ${cfg.enabled ? 'on' : ''}`} onClick={() => save({ enabled: !cfg.enabled }).catch(() => {})}>Customer screen: {cfg.enabled ? 'ON' : 'OFF'}</button>
        <button className="chip" onClick={open}>Open customer screen now</button>
      </div>
      <div className="hint">
        {second.length > 0 ? `Second monitor found (${second[0]!.width}x${second[0]!.height}). ` : 'No second monitor found right now. '}
        {cfg.viewers > 0 ? `The customer screen is showing (${cfg.viewers} window).` : 'The customer screen is not open.'}
        {' '}When ON it opens by itself on the second monitor each time the register starts.
      </div>
      <TextSetting label="Welcome message (shown between customers)" value={cfg.welcome} onSave={(v) => save({ welcome: v })} />
    </>
  );
}

// ---------- updates ----------

type UpdateStatus = { current: string; latest: string | null; state: string; message: string; checkedAt: string | null; pending: string | null };

function UpdatesTab({ cashier, version }: { cashier: string; version: string }) {
  const [st, setSt] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api<UpdateStatus>('/api/update/status').then(setSt).catch((e: Error) => setMsg(e.message));
  useEffect(() => { load(); const t = window.setInterval(load, 5000); return () => window.clearInterval(t); }, []);
  const check = async () => {
    setBusy(true); setMsg('');
    try { const r = await api<UpdateStatus>('/api/update/check', { cashier }); setSt(r); if (r.state === 'up-to-date') play('done'); }
    catch (e) { setMsg((e as Error).message); play('bad'); } finally { setBusy(false); }
  };
  const install = async () => {
    try { await api('/api/update/restart', { cashier }); setMsg('Installing… the register restarts and the screen comes back by itself.'); }
    catch (e) { setMsg((e as Error).message); }
  };
  const label: Record<string, string> = { 'up-to-date': 'Up to date', checking: 'Checking…', downloading: 'Downloading…', installing: 'Installing…', restarting: 'Ready to install', error: 'Problem', idle: 'Waiting' };
  return (
    <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {msg && <div className="inv-msg" style={{ margin: 0 }}>{msg}</div>}
      <div className="editor-label">THIS REGISTER</div>
      <div className="field"><span className="field-label">Running version</span><span className="field-value" style={{ fontWeight: 700 }}>v{version}</span></div>
      {st && <>
        <div className="field"><span className="field-label">Newest version</span><span className="field-value">{st.latest ? `v${st.latest}` : 'unknown yet'}</span></div>
        <div className="field"><span className="field-label">Status</span><span className="field-value">{label[st.state] ?? st.state}{st.checkedAt ? ` · checked ${when(st.checkedAt)}` : ''}</span></div>
        {st.message && <div className="hint">{st.message}</div>}
      </>}
      <div className="quick" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <button className="btn btn-primary" disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check for updates now'}</button>
        <button className="btn btn-dark" disabled={!st?.pending} onClick={install}>{st?.pending ? `Install v${st.pending} now` : 'Nothing to install'}</button>
      </div>
      <div className="hint">The register checks every 10 minutes on its own. An update installs by itself as soon as the ticket is empty; if a ticket is open, a green button appears on the register so the cashier can install it when ready.</div>
    </div>
  );
}

// ---------- settings & tax ----------

type AuthRow = { id: number; title: string; type: 'tax' | 'fee'; rateBp: number | null; flatCents: number | null; inUse: number };
type Settings = { authorities: AuthRow[]; checkFeeCents: number; trackStock: boolean; scanIdOnly: boolean };
type TaxIssue = { id: number; name: string; category: string; current: string; suggestedId: number | null; suggested: string; why: string };

function pctText(bp: number) { return bp % 100 === 0 ? `${bp / 100}%` : `${(bp / 100).toFixed(2)}%`; }

function SettingsTab({ pin, cashier }: { pin: string; cashier: string }) {
  const [st, setSt] = useState<Settings | null>(null);
  const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState<null | { id: number | null; title: string; rateBp: number }>(null);
  const [issues, setIssues] = useState<{ items: TaxIssue[]; total: number } | null>(null);
  const [fixing, setFixing] = useState<number | null>(null);
  const load = () => Promise.all([api<Settings>('/api/settings').then(setSt), api<{ items: TaxIssue[]; total: number }>('/api/tax-check').then(setIssues)]).catch((e: Error) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  if (!st) return <div className="hint">Loading…</div>;
  const save = async (patch: Partial<Settings>) => {
    try { await api('/api/settings', { pin, cashier, ...patch }); setSt({ ...st, ...patch }); setMsg('Saved.'); play('done'); } catch (e) { setMsg((e as Error).message); play('bad'); }
  };
  const saveAuth = async () => {
    if (!edit) return;
    try {
      if (edit.id === null) await api('/api/authorities', { pin, cashier, title: edit.title, rateBp: edit.rateBp, flatCents: null });
      else await api(`/api/authorities/${edit.id}`, { pin, cashier, title: edit.title, rateBp: edit.rateBp, flatCents: null });
      setEdit(null); setMsg('Saved.'); play('done'); load();
    } catch (e) { setMsg((e as Error).message); play('bad'); }
  };
  const removeAuth = async (a: AuthRow) => {
    try { await api(`/api/authorities/${a.id}/delete`, { pin, cashier }); setMsg(`${a.title} removed.`); load(); } catch (e) { setMsg((e as Error).message); play('bad'); }
  };
  const fix = async (it: TaxIssue, authorityId: number | null) => {
    setFixing(it.id);
    try { await api(`/api/items/${it.id}`, { pin, cashier, authorityId, reason: 'tax check' }); setIssues((cur) => cur ? { items: cur.items.filter((x) => x.id !== it.id), total: cur.total - 1 } : cur); play('ok'); }
    catch (e) { setMsg((e as Error).message); play('bad'); } finally { setFixing(null); }
  };
  return (
    <div style={{ maxWidth: 860, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {msg && <div className="inv-msg" style={{ margin: 0 }}>{msg}</div>}

      <div className="editor-label">TAX GROUPS</div>
      <div className="hint">Each item belongs to one tax group. Change a percentage here and every item in that group follows. Flat fees (like a per-unit charge) stay as they are.</div>
      {st.authorities.map((a) => (
        <div key={a.id} className="field" style={{ gap: 10 }}>
          <span className="field-label" style={{ flex: 1 }}>{a.title}<small style={{ display: 'block', color: 'var(--ink-3)', fontWeight: 400 }}>{a.inUse} items</small></span>
          <span className="field-value num" style={{ fontWeight: 700, minWidth: 90, textAlign: 'right' }}>{a.rateBp !== null ? pctText(a.rateBp) : `${formatCents(a.flatCents ?? 0)}/each`}</span>
          {a.rateBp !== null && <button className="btn btn-sm" onClick={() => setEdit({ id: a.id, title: a.title, rateBp: a.rateBp ?? 0 })}>Change</button>}
          {a.inUse === 0 && <button className="btn btn-sm btn-danger" onClick={() => removeAuth(a)}>Remove</button>}
        </div>
      ))}
      <button className="btn btn-block" onClick={() => setEdit({ id: null, title: '', rateBp: 800 })}><Icon name="plus" size={18} /> Add a tax group</button>

      <div className="editor-label">ITEMS THAT MAY BE IN THE WRONG TAX GROUP</div>
      {issues && issues.items.length === 0 && <div className="hint">Nothing looks out of place.</div>}
      {issues && issues.items.length > 0 && <div className="hint">{issues.total} item{issues.total === 1 ? '' : 's'} whose name or category doesn't match the tax group they're in. Tap the suggestion to move it, or leave it if it's right.</div>}
      {issues?.items.slice(0, 60).map((it) => (
        <div key={it.id} className="field" style={{ gap: 10 }}>
          <span className="field-label" style={{ flex: 1 }}>{it.name}<small style={{ display: 'block', color: 'var(--ink-3)', fontWeight: 400 }}>{it.category} · now in <b>{it.current}</b> · {it.why}</small></span>
          <button className="btn btn-sm btn-primary" disabled={fixing === it.id} onClick={() => fix(it, it.suggestedId)}>Move to {it.suggested}</button>
        </div>
      ))}
      {issues && issues.items.length > 60 && <div className="hint">Showing the first 60. Fix these and more will appear.</div>}

      <div className="editor-label">CHECK CASHING</div>
      <div className="field">
        <span className="field-label" style={{ flex: 1 }}>Usual fee for cashing a check (the cashier can change it per check)</span>
        <div className="chips">
          {[0, 100, 200, 300, 500].map((c) => <button key={c} className={`chip ${st.checkFeeCents === c ? 'on' : ''}`} onClick={() => save({ checkFeeCents: c })}>{c === 0 ? 'No fee' : formatCents(c)}</button>)}
        </div>
      </div>

      <div className="editor-label">STOCK</div>
      <div className="chips">
        <button className={`chip ${st.trackStock ? 'on' : ''}`} onClick={() => save({ trackStock: !st.trackStock })}>Keep track of stock counts: {st.trackStock ? 'ON' : 'OFF'}</button>
      </div>
      <div className="hint">Off hides stock counts everywhere. Nothing is deleted; turn it back on any time.</div>

      <div className="editor-label">ID CHECK</div>
      <div className="chips">
        <button className={`chip ${st.scanIdOnly ? 'on' : ''}`} onClick={() => save({ scanIdOnly: !st.scanIdOnly })}>Typing a birth date needs a manager PIN: {st.scanIdOnly ? 'ON' : 'OFF'}</button>
      </div>

      {edit && <RateModal edit={edit} onClose={() => setEdit(null)} onChange={setEdit}
        onSave={() => saveAuth()} />}
    </div>
  );
}

function RateModal({ edit, onClose, onChange, onSave }: { edit: { id: number | null; title: string; rateBp: number }; onClose: () => void; onChange: (e: { id: number | null; title: string; rateBp: number }) => void; onSave: () => void }) {
  const [digits, setDigits] = useState(String(edit.rateBp));
  const [kb, setKb] = useState(edit.id === null);
  const bp = parseInt(digits || '0', 10);
  const press = (k: string) => {
    if (k === 'clear') setDigits('');
    else if (k === 'back') setDigits((d) => d.slice(0, -1));
    else setDigits((d) => (d + k).replace(/^0+(?=\d)/, '').slice(0, 5));
  };
  useEffect(() => { onChange({ ...edit, rateBp: bp }); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [bp]);
  const isFee = edit.id === -1;
  return (
    <Modal title={edit.id === null ? 'New tax group' : edit.title} onClose={onClose} footer={
      <button className="btn btn-primary btn-block" style={{ minHeight: 56 }} disabled={!isFee && !edit.title.trim()} onClick={onSave}>Save {pctText(bp)}</button>}>
      {!isFee && (
        <>
          <div className="field-label">NAME</div>
          <div className="quick" style={{ gridTemplateColumns: '1fr auto' }}>
            <div className="display plain" style={{ height: 48, fontSize: 20, justifyContent: 'flex-start', fontWeight: 600 }}>{edit.title || <span style={{ color: 'var(--ink-3)' }}>e.g. Alcohol</span>}</div>
            <button className="btn" onClick={() => setKb(!kb)}><Icon name="keyboard" size={20} /></button>
          </div>
          {kb && <OnScreenKeyboard onChar={(c) => onChange({ ...edit, title: edit.title + c })} onBack={() => onChange({ ...edit, title: edit.title.slice(0, -1) })} onClear={() => onChange({ ...edit, title: '' })} onDone={() => setKb(false)} />}
        </>
      )}
      <div className="field-label">PERCENT — type it in hundredths: 8 0 0 = 8%, 1 0 0 = 1%, 8 5 0 = 8.5%</div>
      <div className="display num">{pctText(bp)}</div>
      {!kb && <Keypad onKey={press} onEnter={onSave} />}
    </Modal>
  );
}

// ---------- customer tabs ----------

type TabEntry = { id: number; ts: string; kind: 'charge' | 'payment' | 'adjust'; cents: number; receiptNo: string | null; tender: string | null; cashier: string; note: string | null };

function CustomersTab({ pin, cashier }: { pin: string; cashier: string }) {
  const [list, setList] = useState<CustomerDto[]>([]);
  const [q, setQ] = useState('');
  const [kb, setKb] = useState(false);
  const [sel, setSel] = useState<CustomerDto | null>(null);
  const [hist, setHist] = useState<TabEntry[]>([]);
  const [msg, setMsg] = useState('');
  const [paying, setPaying] = useState(false);
  const [adjust, setAdjust] = useState<null | 'forgive' | 'add'>(null);
  const [editing, setEditing] = useState(false);
  const load = () => api<CustomerDto[]>('/api/customers?all=1').then((l) => { setList(l); if (sel) setSel(l.find((c) => c.id === sel.id) ?? null); }).catch((e: Error) => setMsg(e.message));
  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { if (sel) api<TabEntry[]>(`/api/customers/${sel.id}/history`).then(setHist).catch(() => setHist([])); }, [sel?.id, sel?.balanceCents]);
  useTypedText({ onChar: (c) => setQ((s) => s + c), onBack: () => setQ((s) => s.slice(0, -1)), allowDigits: true, enabled: !paying && !adjust && !editing });
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = list.filter((c) => c.active && words.every((w) => `${c.name} ${c.phone ?? ''}`.toLowerCase().includes(w)));
  const owed = list.filter((c) => c.active).reduce((s, c) => s + c.balanceCents, 0);
  const add = async () => {
    const name = q.trim(); if (!name) return;
    try { const c = await api<CustomerDto>('/api/customers', { cashier, name }); setQ(''); await load(); setSel(c); setMsg(`${c.name} added.`); } catch (e) { setMsg((e as Error).message); }
  };
  const kindLabel = (e: TabEntry) => e.kind === 'charge' ? `Charged · receipt ${e.receiptNo ?? ''}` : e.kind === 'payment' ? `Paid by ${e.tender}` : (e.cents < 0 ? 'Forgiven' : 'Added') + (e.note ? ` · ${e.note}` : '');
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {msg && <div className="inv-msg" style={{ margin: 0 }}>{msg}</div>}
        <div className="field"><span className="field-label">All tabs owed</span><span className="field-value num" style={{ fontWeight: 800, fontSize: 24 }}>{formatCents(owed)}</span></div>
        <div className="quick" style={{ gridTemplateColumns: '1fr auto auto' }}>
          <div className="display plain" style={{ height: 48, fontSize: 18, justifyContent: 'flex-start', fontWeight: 500 }}>{q || <span style={{ color: 'var(--ink-3)' }}>Search or type a new name…</span>}</div>
          <button className="btn" onClick={() => setKb(!kb)}><Icon name="keyboard" size={20} /></button>
          <button className="btn btn-primary" disabled={!q.trim() || shown.some((c) => c.name.toLowerCase() === q.trim().toLowerCase())} onClick={add}>Add</button>
        </div>
        {kb && <OnScreenKeyboard onChar={(c) => setQ((s) => s + c)} onBack={() => setQ((s) => s.slice(0, -1))} onClear={() => setQ('')} onDone={() => setKb(false)} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '60vh', overflowY: 'auto' }}>
          {shown.map((c) => (
            <button key={c.id} className={`pick ${sel?.id === c.id ? 'on' : ''}`} onClick={() => setSel(c)}>
              <b style={{ display: 'flex', justifyContent: 'space-between' }}><span>{c.name}</span><span className="num" style={{ color: c.balanceCents > 0 ? 'var(--bad)' : 'var(--accent)' }}>{formatCents(c.balanceCents)}</span></b>
              <small>{c.phone ?? ''}{c.lastAt ? ` · last ${when(c.lastAt)}` : ' · nothing yet'}</small>
            </button>
          ))}
          {shown.length === 0 && <div className="hint">{list.length === 0 ? 'No customers yet. Type a name and tap Add.' : 'No one matches.'}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!sel && <div className="hint">Tap a customer to see their tab, take a payment, or change their details.</div>}
        {sel && <>
          <div className="field"><span className="field-label" style={{ fontSize: 20 }}>{sel.name}<small style={{ display: 'block', fontWeight: 400, color: 'var(--ink-3)' }}>{sel.phone ?? 'no phone'}{sel.note ? ` · ${sel.note}` : ''}</small></span>
            <span className="field-value num" style={{ fontWeight: 800, fontSize: 28, color: sel.balanceCents > 0 ? 'var(--bad)' : 'var(--accent)' }}>{formatCents(sel.balanceCents)}</span></div>
          <div className="quick" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <button className="btn btn-primary" disabled={sel.balanceCents <= 0} onClick={() => setPaying(true)}>Take a payment</button>
            <button className="btn" onClick={() => setAdjust('forgive')}>Forgive / write off</button>
            <button className="btn" onClick={() => setEditing(true)}>Edit details</button>
            <button className="btn btn-danger" disabled={sel.balanceCents !== 0} title={sel.balanceCents !== 0 ? 'Settle the tab first' : ''}
              onClick={async () => { try { await api(`/api/customers/${sel.id}`, { pin, cashier, active: false }); setSel(null); load(); } catch (e) { setMsg((e as Error).message); } }}>Remove</button>
          </div>
          <div className="editor-label">HISTORY</div>
          <table className="rep"><tbody>
            {hist.map((e) => (
              <tr key={e.id}><td>{when(e.ts)}</td><td>{kindLabel(e)}</td><td className="hint">{e.cashier}</td>
                <td className="num" style={{ color: e.kind === 'payment' || e.cents < 0 ? 'var(--accent)' : 'inherit' }}>{e.kind === 'payment' ? '−' : e.cents < 0 ? '−' : '+'}{formatCents(Math.abs(e.cents))}</td></tr>
            ))}
            {hist.length === 0 && <tr><td className="hint">Nothing on this tab yet.</td></tr>}
          </tbody></table>
        </>}
      </div>
      {paying && sel && <TabPaymentModal customer={sel} cashier={cashier} onClose={() => setPaying(false)} onDone={(bal) => { setPaying(false); setMsg(`Payment taken. ${sel.name} now owes ${formatCents(bal)}.`); load(); }} />}
      {adjust && sel && <AdjustModal customer={sel} mode={adjust} pin={pin} cashier={cashier} onClose={() => setAdjust(null)} onDone={(bal) => { setAdjust(null); setMsg(`Done. ${sel.name} now owes ${formatCents(bal)}.`); load(); }} />}
      {editing && sel && <CustomerEditModal customer={sel} pin={pin} cashier={cashier} onClose={() => setEditing(false)} onDone={() => { setEditing(false); load(); }} />}
    </div>
  );
}

function AdjustModal({ customer, mode, pin, cashier, onClose, onDone }: { customer: CustomerDto; mode: 'forgive' | 'add'; pin: string; cashier: string; onClose: () => void; onDone: (bal: number) => void }) {
  const [digits, setDigits] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const cents = centsFromKeypadDigits(digits);
  const press = (k: string) => { if (k === 'clear') setDigits(''); else if (k === 'back') setDigits((d) => d.slice(0, -1)); else setDigits((d) => (d + k).replace(/^0+(?=\d)/, '').slice(0, 8)); };
  useTypedText({ onChar: (c) => setNote((s) => s + c), onBack: () => setNote((s) => s.slice(0, -1)), allowDigits: false });
  const go = async () => {
    try { const r = await api<{ balanceCents: number }>(`/api/customers/${customer.id}/adjust`, { pin, cashier, cents: mode === 'forgive' ? -cents : cents, note }); onDone(r.balanceCents); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title={mode === 'forgive' ? `Forgive part of ${customer.name}'s tab` : `Add to ${customer.name}'s tab`} onClose={onClose} footer={<>
      {error && <div className="err">{error}</div>}
      <button className="btn btn-primary btn-block" style={{ minHeight: 54 }} disabled={cents <= 0 || !note.trim()} onClick={go}>{mode === 'forgive' ? 'Forgive' : 'Add'} {formatCents(cents)}</button>
    </>}>
      <div className="display num">{formatCents(cents)}</div>
      <Keypad onKey={press} doubleZero />
      <div className="field-label">REASON (type on the keyboard)</div>
      <div className="display plain" style={{ height: 44, fontSize: 18, justifyContent: 'flex-start', fontWeight: 500 }}>{note || <span style={{ color: 'var(--ink-3)' }}>e.g. written off, typed wrong</span>}</div>
      <div className="hint">Logged with your name. {mode === 'forgive' ? 'Lowers what they owe without any money changing hands.' : 'Raises what they owe (an old balance from the paper book, for example).'}</div>
    </Modal>
  );
}

function CustomerEditModal({ customer, pin, cashier, onClose, onDone }: { customer: CustomerDto; pin: string; cashier: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [note, setNote] = useState(customer.note ?? '');
  const [which, setWhich] = useState<'name' | 'phone' | 'note'>('name');
  const [error, setError] = useState('');
  const setter = which === 'name' ? setName : which === 'phone' ? setPhone : setNote;
  useTypedText({ onChar: (c) => setter((s) => s + c), onBack: () => setter((s) => s.slice(0, -1)), allowDigits: true });
  const save = async () => { try { await api(`/api/customers/${customer.id}`, { pin, cashier, name, phone, note }); onDone(); } catch (e) { setError((e as Error).message); } };
  const Row = ({ k, label, v }: { k: 'name' | 'phone' | 'note'; label: string; v: string }) => (
    <button className={`pick ${which === k ? 'on' : ''}`} onClick={() => setWhich(k)}><small>{label}</small><b>{v || '—'}</b></button>
  );
  return (
    <Modal title="Customer details" onClose={onClose} footer={<>{error && <div className="err">{error}</div>}<button className="btn btn-primary btn-block" style={{ minHeight: 54 }} disabled={!name.trim()} onClick={save}>Save</button></>}>
      <Row k="name" label="Name" v={name} /><Row k="phone" label="Phone" v={phone} /><Row k="note" label="Note" v={note} />
      <OnScreenKeyboard onChar={(c) => setter((s) => s + c)} onBack={() => setter((s) => s.slice(0, -1))} onClear={() => setter('')} />
    </Modal>
  );
}
