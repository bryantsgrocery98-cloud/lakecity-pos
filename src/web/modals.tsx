import { useEffect, useState } from 'react';
import { formatCents, centsFromKeypadDigits } from '../core/money';
import { evaluateBirthDate, parseAamvaDate } from '../core/aamva';
import type { Authority } from '../core/tax';
import type { ButtonDto, CustomerDto, HoldDto, ItemDto, Receipt } from '../core/types';
import { api } from './api';
import { play } from './sounds';
import { Icon, Keypad, Modal, OnScreenKeyboard, useTypedText } from './parts';

export type AgeInfo = {
  method: 'scan' | 'manual_dob' | 'manager_override';
  ageYears: number | null;
  expired: boolean;
  managerPin?: string;
};

/** Collects keypad digits. Money keypads treat the digits as cents (typing 2 0 0 0 gives $20.00). */
function useDigits(max: number) {
  const [digits, setDigits] = useState('');
  const press = (k: string) => {
    if (k === 'clear') setDigits('');
    else if (k === 'back') setDigits((d) => d.slice(0, -1));
    else setDigits((d) => (d + k).replace(/^0+(?=\d)/, '').slice(0, max));
  };
  return { digits, press, set: setDigits };
}

export function CashModal({ total, title, onClose, onComplete, error, busy }: {
  total: number; title?: string; onClose: () => void; onComplete: (tendered: number) => void; error: string; busy: boolean;
}) {
  const { digits, press, set } = useDigits(7);
  const tendered = centsFromKeypadDigits(digits);
  const change = tendered - total;
  const bills = [100, 500, 1000, 2000, 5000, 10000];
  return (
    <Modal title={title ?? 'Cash'} onClose={onClose} footer={<>
      <div className={`change ${change < 0 ? 'short' : ''}`} style={{ margin: 0 }}>
        <span>{change < 0 ? 'Still needed' : 'Change due'}</span>
        <span className="num">{formatCents(Math.abs(change))}</span>
      </div>
      {error && <div className="err">{error}</div>}
      <button className="btn btn-primary btn-block" style={{ minHeight: 58, fontSize: 22 }} disabled={change < 0 || busy}
        onClick={() => onComplete(tendered)}>Complete sale</button>
    </>}>
      <div className="hint">Total due <b className="num" style={{ fontSize: 24, color: 'var(--ink)' }}>{formatCents(total)}</b></div>
      <div className="quick">
        <button className="btn btn-dark" onClick={() => set(String(total))}>Exact</button>
        {bills.map((b) => <button key={b} className="btn" onClick={() => set(String(b))}>{formatCents(b).replace('.00', '')}</button>)}
      </div>
      <div className="display num" aria-label="Cash given">{formatCents(tendered)}</div>
      <Keypad onKey={(k) => { if (k === '00') { press('0'); press('0'); } else press(k); }} doubleZero onEnter={() => { if (change >= 0 && !busy) onComplete(tendered); }} />
    </Modal>
  );
}

export function CardModal({ total, onClose, onComplete, error, busy }: {
  total: number; onClose: () => void; onComplete: () => void; error: string; busy: boolean;
}) {
  return (
    <Modal title="Card" onClose={onClose}>
      <div className="display num" style={{ justifyContent: 'center', fontSize: 52, height: 96 }}>{formatCents(total)}</div>
      <div className="hint" style={{ fontSize: 18, textAlign: 'center' }}>Run this amount on the card machine.</div>
      {error && <div className="err">{error}</div>}
      <button className="btn btn-primary btn-block" style={{ minHeight: 72, fontSize: 24 }} disabled={busy} onClick={onComplete}>Card approved, complete sale</button>
      <button className="btn btn-block" onClick={onClose}>Card declined / go back</button>
    </Modal>
  );
}

export function AskModal({ title, onClose, onAdd }: { title: string; onClose: () => void; onAdd: (cents: number) => void }) {
  const { digits, press } = useDigits(7);
  const cents = centsFromKeypadDigits(digits);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="hint">Type the price. Digits fill in from the right, so 4 5 0 makes $4.50.</div>
      <div className="display num">{formatCents(cents)}</div>
      <Keypad onKey={(k) => (k === '00' ? (press('0'), press('0')) : press(k))} doubleZero onEnter={() => { if (cents > 0) onAdd(cents); }} />
      <button className="btn btn-primary btn-block" style={{ minHeight: 64, fontSize: 22 }} disabled={cents <= 0} onClick={() => onAdd(cents)}>Add to ticket</button>
    </Modal>
  );
}

export function LotteryModal({ onClose, onAdd }: { onClose: () => void; onAdd: (qty: number, unitCents: number) => void }) {
  // One simple screen: type the total lottery amount, done. Quick buttons for the common ones.
  const { digits, press, set } = useDigits(6);
  const amount = centsFromKeypadDigits(digits);
  const presets = [100, 200, 500, 1000, 2000];
  const go = () => { if (amount > 0) onAdd(1, amount); };
  return (
    <Modal title="Lottery" onClose={onClose} footer={
      <button className="btn btn-primary btn-block" style={{ minHeight: 56, fontSize: 22 }} disabled={amount <= 0} onClick={go}>Add {formatCents(amount)} lottery</button>}>
      <div className="quick" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {presets.map((p) => <button key={p} className="btn" onClick={() => set(String(p))}>{formatCents(p).replace('.00', '')}</button>)}
      </div>
      <div className="display num" aria-label="Lottery amount">{formatCents(amount)}</div>
      <Keypad onKey={(k) => (k === '00' ? (press('0'), press('0')) : press(k))} doubleZero onEnter={go} />
      <div className="hint">No tax. Counted separately from store sales.</div>
    </Modal>
  );
}

export function PayoutModal({ onClose, onSave }: { onClose: () => void; onSave: (cents: number) => void }) {
  // Winning lottery ticket: the amount goes on the ticket and pays for whatever they buy; the rest is cash back.
  const { digits, press } = useDigits(7);
  const cents = centsFromKeypadDigits(digits);
  return (
    <Modal title="Lottery winnings" onClose={onClose}>
      <div className="hint">Type the amount on the winning ticket. It pays for anything they buy; whatever is left is handed back in cash. Counted as a lottery payout on the day report.</div>
      <div className="display num">{formatCents(cents)}</div>
      <Keypad onKey={(k) => (k === '00' ? (press('0'), press('0')) : press(k))} doubleZero onEnter={() => { if (cents > 0) onSave(cents); }} />
      <button className="btn btn-primary btn-block" style={{ minHeight: 64, fontSize: 22 }} disabled={cents <= 0} onClick={() => onSave(cents)}>Add winnings to ticket</button>
    </Modal>
  );
}

export function QtyModal({ current, onClose, onSet }: { current: number; onClose: () => void; onSet: (n: number) => void }) {
  const { digits, press } = useDigits(5);
  const n = digits === '' ? current : parseInt(digits, 10);
  return (
    <Modal title="Quantity" onClose={onClose}>
      <div className="display num">{n}</div>
      <Keypad onKey={(k) => (k === '00' ? undefined : press(k))} onEnter={() => { if (n >= 1) onSet(n); }} />
      <button className="btn btn-primary btn-block" style={{ minHeight: 60 }} disabled={n < 1} onClick={() => onSet(n)}>Set quantity</button>
    </Modal>
  );
}

/** Checks a manager or owner PIN with the server, then hands the PIN back. */
export function PinModal({ title, hint, onClose, onOk }: { title: string; hint: string; onClose: () => void; onOk: (pin: string) => void }) {
  const { digits, press } = useDigits(8);
  const [error, setError] = useState('');
  const submit = async () => {
    try {
      const u = await api<{ role: string }>('/api/login', { pin: digits });
      if (u.role === 'cashier') { setError('That PIN is not a manager PIN.'); return; }
      onOk(digits);
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <div className="hint">{hint}</div>
      <div className="dots" aria-label={`${digits.length} digits entered`}>{Array.from({ length: Math.max(4, digits.length) }).map((_, i) => <i key={i} className={i < digits.length ? 'f' : ''} />)}</div>
      <Keypad onKey={(k) => (k === '00' ? undefined : press(k))} onEnter={() => { if (digits.length >= 4) submit(); }} />
      {error && <div className="err">{error}</div>}
      <button className="btn btn-primary btn-block" style={{ minHeight: 60 }} disabled={digits.length < 4} onClick={submit}>OK</button>
    </Modal>
  );
}

export function IdModal({ required, info, scanIdOnly, onClose, onManual, onManager, onRemoveRestricted }: {
  required: number; info: AgeInfo | null; scanIdOnly: boolean; onClose: () => void;
  onManual: () => void; onManager: () => void; onRemoveRestricted: () => void;
}) {
  const passed = info && (info.method === 'manager_override' || (info.ageYears !== null && info.ageYears >= required && !info.expired));
  const under = info && info.ageYears !== null && info.ageYears < required;
  const expired = info && info.expired && !under;
  if (info && passed) {
    return (
      <Modal title="ID check" onClose={onClose}>
        <div className="result good">
          <div className="head"><Icon name="ok" size={52} /><div className="big">APPROVED · {required}+</div>
            <div className="age">{info.method === 'manager_override' ? 'Approved by a manager' : `Customer is ${info.ageYears} — legal for ${required}+ in SC`}</div></div>
        </div>
        <div className="hint">Nothing from the ID is saved. Only the result, time, and cashier are logged. This tool checks age only. The cashier must still look at the ID.</div>
        <button className="btn btn-primary btn-block" style={{ minHeight: 64, fontSize: 22 }} onClick={onClose}>Continue</button>
      </Modal>
    );
  }
  if (info && under) {
    return (
      <Modal title="ID check">
        <div className="result bad">
          <div className="head"><Icon name="ban" size={52} /><div className="big">UNDER AGE</div><div className="age">Do not sell · customer is {info.ageYears}, needs {required}+</div></div>
        </div>
        <button className="btn btn-dark btn-block" style={{ minHeight: 60 }} onClick={onRemoveRestricted}>Remove age-restricted items</button>
        <button className="btn btn-block" onClick={onClose}>Back to ticket</button>
      </Modal>
    );
  }
  if (info && expired) {
    return (
      <Modal title="ID check">
        <div className="result warn">
          <div className="head"><Icon name="id" size={52} /><div className="big">ID EXPIRED</div><div className="age">Age is {info.ageYears}. Check this ID by hand.</div></div>
        </div>
        <button className="btn btn-dark btn-block" onClick={onManager}>Manager approves anyway</button>
        <button className="btn btn-block" onClick={onClose}>Back to ticket</button>
      </Modal>
    );
  }
  return (
    <Modal title="Scan ID" onClose={onClose}>
      <div style={{ height: 150, borderRadius: 16, background: 'var(--bg)', border: '2px dashed #7c8c99', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: 'var(--ink-2)' }}>
        <Icon name="id" size={56} />
        <div style={{ fontSize: 18, textAlign: 'center', padding: '0 16px' }}>Scan the barcode on the back of the ID</div>
      </div>
      <div className="hint">Needed: {required}+ for items on this ticket. One scan covers the whole ticket.</div>
      <button className="btn btn-block" onClick={onManual}>Type birth date{scanIdOnly ? ' (manager PIN)' : ''}</button>
      <button className="btn btn-block" onClick={onManager}>Bypass — manager or owner PIN</button>
      <div className="hint">This tool checks age only. The cashier must still look at the ID.</div>
      <button className="btn btn-quiet btn-block" onClick={onClose}>Cancel</button>
    </Modal>
  );
}

export function DobModal({ onClose, onDone }: { onClose: () => void; onDone: (r: { ageYears: number; expired: boolean }) => void }) {
  const { digits, press } = useDigits(8);
  const [error, setError] = useState('');
  const shown = `${digits.slice(0, 2).padEnd(2, '–')}/${digits.slice(2, 4).padEnd(2, '–')}/${digits.slice(4, 8).padEnd(4, '–')}`;
  const submit = () => {
    const iso = parseAamvaDate(digits);
    const r = iso ? evaluateBirthDate(iso, null) : null;
    if (!r || !r.ok) { setError(r && !r.ok ? r.reason : 'Enter the birth date as month, day, year.'); return; }
    onDone({ ageYears: r.ageYears, expired: false });
  };
  return (
    <Modal title="Birth date" onClose={onClose}>
      <div className="hint">Type month, day, and 4-digit year from the ID. Example: 0 7 1 5 1 9 9 0</div>
      <div className="display plain num">{shown}</div>
      <Keypad onKey={(k) => (k === '00' ? undefined : press(k))} onEnter={() => { if (digits.length === 8) submit(); }} />
      {error && <div className="err">{error}</div>}
      <button className="btn btn-primary btn-block" style={{ minHeight: 60 }} disabled={digits.length !== 8} onClick={submit}>Check age</button>
    </Modal>
  );
}

export type Lookup = { found: boolean; code: string; name: string; size: string | null; imageUrl: string | null; category: string | null; ageMin: number | null; source: string | null; error?: string | null };

export function LinkModal({ code, items, lookup, onClose, onLink, onNew, error }: {
  code: string; items: ItemDto[]; lookup: Lookup | null | undefined; onClose: () => void; onLink: (itemId: number) => void; onNew: () => void; error: string;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  useTypedText({ onChar: (c) => setQ((s) => s + c), onBack: () => setQ((s) => s.slice(0, -1)), allowDigits: true });
  const matches = items.filter((i) => !i.hasBarcode && `${i.name} ${i.size ?? ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 5);
  return (
    <Modal title="New barcode" onClose={onClose} wide footer={<>
      {error && <div className="err">{error}</div>}
      <button className="btn btn-primary btn-block" style={{ minHeight: 56 }} disabled={sel === null} onClick={() => sel !== null && onLink(sel)}>{sel === null ? 'Pick an item below to link, or add as new above' : 'Link and add to ticket'}</button>
    </>}>
      <div style={{ padding: '10px 14px', borderRadius: 12, background: 'var(--warn-bg)', border: '2px solid var(--warn-line)', color: 'var(--warn-ink)' }}>
        <div className="hint" style={{ color: 'inherit', fontWeight: 600 }}>SCANNED, NOT IN THE SYSTEM YET</div>
        <div className="num" style={{ fontSize: 26, letterSpacing: '.04em' }}>{code}</div>
      </div>
      <button className="pick" style={{ minHeight: 84, display: 'flex', alignItems: 'center', gap: 14, borderColor: 'var(--accent)', borderWidth: 2 }} onClick={onNew}>
        {lookup?.imageUrl && <img src={lookup.imageUrl} alt="" style={{ width: 64, height: 64, objectFit: 'contain', borderRadius: 8, background: '#fff' }} />}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
          {lookup === undefined && <><b>Looking it up online…</b><small>Searching the open product database</small></>}
          {lookup && lookup.found && <><b>Add as new item: {lookup.name}{lookup.size ? ` ${lookup.size}` : ''}</b><small>Found online{lookup.category ? ` · looks like ${lookup.category}` : ''} · tap, set the price, done</small></>}
          {lookup !== undefined && !lookup?.found && <><b>Add as a new item</b><small>{lookup?.error ? `Couldn't reach the product database (${lookup.error})` : 'Not found online'} · type the name and price</small></>}
        </span>
      </button>
      <div className="hint">Or link it to an item that is already in the system but has no barcode yet:</div>
      <div className="display plain" style={{ height: 52, fontSize: 20, justifyContent: 'flex-start', fontWeight: 400 }}>{q || <span style={{ color: 'var(--ink-3)' }}>Search for the item…</span>}</div>
      {matches.map((m) => (
        <button key={m.id} className={`pick ${sel === m.id ? 'on' : ''}`} onClick={() => setSel(m.id)}>
          <b>{m.name} {m.size ?? ''}</b><small>{formatCents(m.priceCents)} · {m.category} · no barcode yet</small>
        </button>
      ))}
      {matches.length === 0 && <div className="hint">No items without a barcode match that search.</div>}
      <OnScreenKeyboard onChar={(c) => setQ((s) => s + c)} onBack={() => setQ((s) => s.slice(0, -1))} onClear={() => setQ('')} />
    </Modal>
  );
}

/** Adds a scanned item in seconds: name (prefilled from the lookup), price, tax group. */
export function NewItemModal({ code, lookup, categories, authorities, onClose, onSave, error, busy }: {
  code: string; lookup: Lookup | null; categories: string[]; authorities: Authority[]; onClose: () => void; error: string; busy: boolean;
  onSave: (item: { name: string; size: string | null; priceCents: number; category: string; authorityId: number | null; ageMin: number | null; imageUrl: string | null }) => void;
}) {
  const [name, setName] = useState(lookup?.name ?? '');
  const [kb, setKb] = useState(!lookup?.name);
  useTypedText({ onChar: (c) => setName((s) => s + c), onBack: () => { if (kb) setName((s) => s.slice(0, -1)); }, allowDigits: kb }); // with the keypad showing, Backspace edits the price
  const { digits, press } = useDigits(7);
  const price = centsFromKeypadDigits(digits);
  const restricted = (c: string) => /alcohol|beer|wine|liquor|tobacco|cig|vape/i.test(c);
  // Never default to an age-restricted category: a soda added in a hurry must not end up as "Alcohol".
  const safeDefault = ['Drinks', 'Food & Drink', 'Snack', 'Snacks', 'Grocery', 'Food'].find((c) => categories.includes(c)) ?? categories.find((c) => !restricted(c)) ?? 'Grocery';
  const cats = Array.from(new Set([...(lookup?.category ? [lookup.category] : []), safeDefault, ...categories.filter((c) => !restricted(c)), ...categories.filter(restricted)])).slice(0, 14);
  const [category, setCategory] = useState(lookup?.category ?? safeDefault);
  const guessAuth = (cat: string): number | null => {
    const c = cat.toLowerCase();
    const find = (re: RegExp) => authorities.find((a) => re.test(a.title.toLowerCase()))?.id ?? null;
    if (/alcohol|beer|wine|liquor/.test(c)) return find(/alcohol/);
    if (/tobacco|cig|vape/.test(c)) return find(/tobacco/);
    if (/drink|food|snack|candy|beverage/.test(c)) return find(/food|drink/);
    return find(/grocery|all/) ?? authorities[0]?.id ?? null;
  };
  const [authorityId, setAuthorityId] = useState<number | null>(guessAuth(lookup?.category ?? safeDefault));
  const ageMin = /alcohol|beer|wine|liquor|tobacco|cig|vape/.test(category.toLowerCase()) ? 21 : lookup?.ageMin ?? null;
  const pickCat = (c: string) => { setCategory(c); setAuthorityId(guessAuth(c)); };
  const ok = name.trim().length > 0 && price > 0;
  const save = () => { if (ok && !busy) onSave({ name: name.trim(), size: lookup?.size ?? null, priceCents: price, category, authorityId, ageMin, imageUrl: lookup?.imageUrl ?? null }); };
  return (
    <Modal title="Add new item" onClose={onClose} wide footer={<>
      {error && <div className="err">{error}</div>}
      <button className="btn btn-primary btn-block" style={{ minHeight: 56 }} disabled={!ok || busy} onClick={save}>{busy ? 'Saving…' : `Save and add to ticket${price > 0 ? ` · ${formatCents(price)}` : ''}`}</button>
    </>}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        {lookup?.imageUrl && <img src={lookup.imageUrl} alt="" style={{ width: 72, height: 72, objectFit: 'contain', borderRadius: 10, background: '#fff', border: '1px solid var(--line)' }} />}
        <div style={{ flex: 1 }}>
          <div className="field-label">NAME{lookup?.size ? ` · ${lookup.size}` : ''} · barcode {code}</div>
          <div className="quick" style={{ gridTemplateColumns: '1fr auto' }}>
            <div className="display plain" style={{ height: 52, fontSize: 20, justifyContent: 'flex-start', fontWeight: 600 }}>{name || <span style={{ color: 'var(--ink-3)' }}>Type the item name…</span>}</div>
            <button className="btn" onClick={() => setKb(!kb)}><Icon name="keyboard" size={20} /></button>
          </div>
        </div>
      </div>
      {kb && <OnScreenKeyboard onChar={(c) => setName((s) => s + c)} onBack={() => setName((s) => s.slice(0, -1))} onClear={() => setName('')} onDone={() => setKb(false)} />}
      <div className="field-label">CATEGORY</div>
      <div className="chips">{cats.map((c) => <button key={c} className={`chip ${category === c ? 'on' : ''}`} onClick={() => pickCat(c)}>{c}</button>)}</div>
      <div className="field-label">TAX</div>
      <div className="chips">
        {authorities.map((a) => <button key={a.id} className={`chip ${authorityId === a.id ? 'on' : ''}`} onClick={() => setAuthorityId(a.id)}>{a.title}</button>)}
        <button className={`chip ${authorityId === null ? 'on' : ''}`} onClick={() => setAuthorityId(null)}>No tax</button>
      </div>
      {ageMin ? <div className="err">This category asks for ID ({ageMin}+) every time it is sold. Pick a different category if that is wrong.</div> : <div className="hint">No ID check for this item.</div>}
      <div className="field-label">PRICE</div>
      <div className="display num" aria-label="Price">{formatCents(price)}</div>
      {!kb && <Keypad onKey={(k) => (k === '00' ? (press('0'), press('0')) : press(k))} doubleZero onEnter={save} />}
    </Modal>
  );
}

export function RecallModal({ holds, onClose, onRecall }: { holds: HoldDto[]; onClose: () => void; onRecall: (h: HoldDto) => void }) {
  return (
    <Modal title="Held sales" onClose={onClose}>
      {holds.length === 0 && <div className="hint">Nothing is on hold.</div>}
      {holds.map((h) => {
        const lines = h.lines as { name: string; qty: number; unitCents: number }[];
        const sum = lines.reduce((s, l) => s + l.qty * l.unitCents, 0);
        return (
          <button key={h.id} className="pick" onClick={() => onRecall(h)}>
            <b>{h.label} · {formatCents(sum)}</b>
            <small>{lines.map((l) => `${l.qty} × ${l.name}`).join(', ').slice(0, 90)}</small>
          </button>
        );
      })}
    </Modal>
  );
}

export function DiscountModal({ buttons, current, onClose, onPick }: { buttons: number[]; current: number; onClose: () => void; onPick: (pct: number) => void }) {
  return (
    <Modal title="Ticket discount" onClose={onClose}>
      <div className="hint">Applies to every line before tax. Lottery is never discounted.</div>
      <div className="amounts">
        {buttons.map((b) => <button key={b} className={`btn ${current === b ? 'on' : ''}`} onClick={() => onPick(b)}>{b}%</button>)}
      </div>
      <button className="btn btn-block" onClick={() => onPick(0)}>No discount</button>
    </Modal>
  );
}

export function ConfirmModal({ title, message, yes, onYes, onClose }: { title: string; message: string; yes: string; onYes: () => void; onClose: () => void }) {
  return (
    <Modal title={title}>
      <div style={{ fontSize: 18, lineHeight: 1.4 }}>{message}</div>
      <button className="btn btn-primary btn-block" style={{ minHeight: 60 }} onClick={onYes}>{yes}</button>
      <button className="btn btn-quiet btn-block" onClick={onClose}>Go back</button>
    </Modal>
  );
}

export function ReceiptModal({ receipt, onDone }: { receipt: Receipt; onDone: () => void }) {
  const when = new Date(receipt.createdAt).toLocaleString('en-US', { timeZone: 'America/New_York' });
  return (
    <Modal title="Sale complete">
      {(receipt.payment.tender === 'cash' || receipt.payment.tender === 'check' || receipt.payment.tender === 'lottery') && receipt.payment.changeCents !== null && (
        <div className="change"><span>{receipt.payment.tender === 'cash' || (receipt.payment.tender === 'lottery' && receipt.payment.cashCents) ? 'Change due' : 'Cash to customer'}</span><span className="num">{formatCents(receipt.payment.changeCents)}</span></div>
      )}
      <div className="receipt" id="receipt">
        <div className="c"><b>{receipt.store.name}</b><br />{receipt.store.address}{receipt.store.phone ? <><br />{receipt.store.phone}</> : null}</div>
        <hr />
        <div className="r"><span>{receipt.receiptNo}</span><span>{when}</span></div>
        <div>Cashier: {receipt.cashier}</div>
        <hr />
        {receipt.lines.map((l, i) => (
          <div key={i}>
            <div className="r"><span>{l.name}</span><span>{formatCents(l.grossCents)}</span></div>
            {l.qty > 1 && !l.name.startsWith('Lottery') && <div style={{ paddingLeft: 12 }}>{l.qty} @ {formatCents(l.unitCents)}</div>}
            {l.discountCents > 0 && <div className="r" style={{ paddingLeft: 12 }}><span>Discount</span><span>-{formatCents(l.discountCents)}</span></div>}
          </div>
        ))}
        <hr />
        <div className="r"><span>Subtotal</span><span>{formatCents(receipt.totals.subtotalCents - receipt.totals.discountCents)}</span></div>
        {receipt.totals.taxLines.map((t) => <div key={t.authorityId} className="r"><span>{t.title}</span><span>{formatCents(t.cents)}</span></div>)}
        <div className="r"><b>TOTAL</b><b>{formatCents(receipt.totals.totalCents)}</b></div>
        <hr />
        {receipt.payment.tender === 'cash' ? (
          <>
            <div className="r"><span>Cash</span><span>{formatCents(receipt.payment.tenderedCents ?? 0)}</span></div>
            <div className="r"><span>Change</span><span>{formatCents(receipt.payment.changeCents ?? 0)}</span></div>
          </>
        ) : receipt.payment.tender === 'check' ? (
          <>
            <div className="r"><span>Check</span><span>{formatCents(receipt.payment.tenderedCents ?? 0)}</span></div>
            <div className="r"><span><b>Cash to customer</b></span><span><b>{formatCents(receipt.payment.changeCents ?? 0)}</b></span></div>
          </>
        ) : receipt.payment.tender === 'lottery' ? (
          <>
            <div className="r"><span>Winning ticket</span><span>{formatCents(receipt.payment.tenderedCents ?? 0)}</span></div>
            {!!receipt.payment.cashCents && <div className="r"><span>Cash</span><span>{formatCents(receipt.payment.cashCents)}</span></div>}
            <div className="r"><span><b>{receipt.payment.cashCents ? 'Change' : 'Cash to customer'}</b></span><span><b>{formatCents(receipt.payment.changeCents ?? 0)}</b></span></div>
          </>
        ) : receipt.payment.tender === 'tab' ? (
          <>
            <div className="r"><span><b>ON TAB</b></span><span><b>{receipt.payment.customerName ?? receipt.payment.reference}</b></span></div>
            {receipt.payment.tabBalanceCents != null && <div className="r"><span>Tab balance now</span><span>{formatCents(receipt.payment.tabBalanceCents)}</span></div>}
          </>
        ) : <div className="r"><span>Card</span><span>{formatCents(receipt.payment.amountCents)}{receipt.payment.reference ? ` · ref ${receipt.payment.reference}` : ''}</span></div>}
        <hr />
        <div className="c">{receipt.store.footer}<br />{receipt.store.refundPolicy}</div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn" style={{ flex: 1 }} onClick={() => { api(`/api/sales/${receipt.receiptNo}/print`, {}).catch(() => window.print()); }}>Print receipt</button>
        <button className="btn btn-primary" style={{ flex: 2, minHeight: 60, fontSize: 20 }} onClick={onDone}>New sale</button>
      </div>
    </Modal>
  );
}

type Today = {
  workday: string; sales: { n: number; total: number; tax: number };
  byCategory: { category: string; cents: number }[]; byAuthority: { title: string; cents: number }[]; noSales: number; lotterySales: number;
};

export function TodayModal({ onClose }: { onClose: () => void }) {
  const [t, setT] = useState<Today | null>(null);
  useEffect(() => { api<Today>('/api/reports/today').then(setT).catch(() => setT(null)); }, []);
  return (
    <Modal title="Today so far" onClose={onClose}>
      {!t ? <div className="hint">Loading…</div> : (
        <>
          <div className="hint">Workday {t.workday}</div>
          <table className="rep"><tbody>
            <tr><td>Sales</td><td className="num">{t.sales.n}</td></tr>
            <tr><td>Total taken (with tax)</td><td className="num">{formatCents(t.sales.total)}</td></tr>
            <tr><td>Lottery (separate)</td><td className="num">{formatCents(t.lotterySales)}</td></tr>
            <tr><td>No Sale opens</td><td className="num">{t.noSales}</td></tr>
          </tbody></table>
          <div className="sub-label">BY CATEGORY (BEFORE TAX)</div>
          <table className="rep"><tbody>{t.byCategory.map((c) => <tr key={c.category}><td>{c.category}</td><td className="num">{formatCents(c.cents)}</td></tr>)}</tbody></table>
          <div className="sub-label">TAX BY AUTHORITY</div>
          <table className="rep"><tbody>{t.byAuthority.map((c) => <tr key={c.title}><td>{c.title}</td><td className="num">{formatCents(c.cents)}</td></tr>)}</tbody></table>
          <div className="hint">For filing prep only. Verify rates with the SC Department of Revenue.</div>
        </>
      )}
    </Modal>
  );
}

/** Check cashing: type the check amount, pick the fee (flat dollars), add to the ticket. */
export function CheckModal({ defaultFeeCents, ticketTotal, busy, error, onClose, onDone }: {
  defaultFeeCents: number; ticketTotal: number; busy: boolean; error: string; onClose: () => void; onDone: (checkCents: number, feeCents: number) => void;
}) {
  const { digits, press } = useDigits(8);
  const check = centsFromKeypadDigits(digits);
  const [fee, setFee] = useState(defaultFeeCents);
  const [customFee, setCustomFee] = useState(false);
  const { digits: feeDigits, press: feePress } = useDigits(5);
  const feeCents = customFee ? centsFromKeypadDigits(feeDigits) : fee;
  const cashOut = check - feeCents - ticketTotal;
  const ok = check > 0 && cashOut >= 0 && !busy;
  return (
    <Modal title="Cash a check" onClose={onClose} footer={<>
      {check > 0 && cashOut < 0 && <div className="err">The check does not cover the fee and the items already on the ticket.</div>}
      {error && <div className="err">{error}</div>}
      <button className="btn btn-primary btn-block" style={{ minHeight: 56, fontSize: 20 }} disabled={!ok} onClick={() => onDone(check, feeCents)}>Add to ticket</button>
    </>}>
      <div className="field-label">CHECK AMOUNT — digits fill in from the right, so 5 0 0 0 0 makes $500.00</div>
      <div className="display num" aria-label="Check amount">{formatCents(check)}</div>
      {!customFee && <Keypad onKey={(k) => (k === '00' ? (press('0'), press('0')) : press(k))} doubleZero onEnter={() => { if (ok) onDone(check, feeCents); }} />}
      <div className="field-label">FEE</div>
      <div className="chips">
        {[100, 200, 300, 500].map((c) => <button key={c} className={`chip ${!customFee && fee === c ? 'on' : ''}`} onClick={() => { setCustomFee(false); setFee(c); }}>{formatCents(c)}</button>)}
        <button className={`chip ${!customFee && fee === 0 ? 'on' : ''}`} onClick={() => { setCustomFee(false); setFee(0); }}>No fee</button>
        <button className={`chip ${customFee ? 'on' : ''}`} onClick={() => setCustomFee(true)}>Other…</button>
      </div>
      {customFee && <>
        <div className="display num" style={{ height: 52, fontSize: 28 }} aria-label="Fee">{formatCents(feeCents)}</div>
        <Keypad onKey={(k) => (k === '00' ? (feePress('0'), feePress('0')) : feePress(k))} doubleZero onEnter={() => setCustomFee(false)} />
        <button className="btn btn-block" onClick={() => { setFee(feeCents); setCustomFee(false); }}>Use {formatCents(feeCents)}</button>
      </>}
      <div className="change" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Fee</span><span className="num">{formatCents(feeCents)}</span></div>
        {ticketTotal > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Items on this ticket</span><span className="num">{formatCents(ticketTotal)}</span></div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 24 }}><span>Cash to customer</span><span className="num">{formatCents(Math.max(0, cashOut))}</span></div>
      </div>
      <div className="hint">Ring up anything else the customer is buying, then press <b>CHECK</b> to finish.</div>
    </Modal>
  );
}

export function PowerModal({ ticketOpen, onClose, onPick }: { ticketOpen: boolean; onClose: () => void; onPick: (a: 'refresh' | 'restart' | 'quit' | 'reboot' | 'poweroff') => void }) {
  const [confirm, setConfirm] = useState<null | 'restart' | 'quit' | 'reboot' | 'poweroff'>(null);
  const labels = { restart: 'Restart the register', quit: 'Close the register', reboot: 'Restart the computer', poweroff: 'Shut down the computer' };
  if (confirm) {
    return (
      <Modal title={labels[confirm]} onClose={() => setConfirm(null)}>
        <div className="hint" style={{ fontSize: 17 }}>
          {ticketOpen && <b>The ticket on screen will be lost. </b>}
          {confirm === 'restart' && 'The register program stops and starts again; the screen comes back by itself in about 15 seconds.'}
          {confirm === 'quit' && 'Both screens close and the register program stops. Open it again from the desktop icon.'}
          {confirm === 'reboot' && 'Windows restarts. The register opens by itself after sign-in.'}
          {confirm === 'poweroff' && 'The computer turns off. Press its power button to start again.'}
        </div>
        <button className={`btn btn-block ${confirm === 'poweroff' || confirm === 'reboot' ? 'btn-danger' : 'btn-primary'}`} style={{ minHeight: 60 }} onClick={() => onPick(confirm)}>Yes, {labels[confirm].toLowerCase()}</button>
        <button className="btn btn-block" onClick={() => setConfirm(null)}>Back</button>
      </Modal>
    );
  }
  return (
    <Modal title="Power" onClose={onClose}>
      <div className="hint">If something looks stuck, try these in order.</div>
      <button className="btn btn-dark btn-block" style={{ minHeight: 58 }} onClick={() => {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
        else document.documentElement.requestFullscreen().catch(() => undefined);
        onClose();
      }}>{document.fullscreenElement ? 'Leave full screen' : 'Full screen (hides the window bar)'}</button>
      <button className="btn btn-primary btn-block" style={{ minHeight: 58 }} onClick={() => onPick('refresh')}>Refresh the screen</button>
      <button className="btn btn-block" style={{ minHeight: 58 }} onClick={() => setConfirm('restart')}>Restart the register</button>
      <button className="btn btn-block" style={{ minHeight: 58 }} onClick={() => setConfirm('quit')}>Close the register</button>
      <button className="btn btn-block" style={{ minHeight: 58 }} onClick={() => setConfirm('reboot')}>Restart the computer</button>
    </Modal>
  );
}

/** Pick a customer (or add one) for a tab charge or a tab payment. */
export function CustomerPickModal({ title, hint, cashier, onClose, onPick }: { title: string; hint: string; cashier: string; onClose: () => void; onPick: (c: CustomerDto) => void }) {
  const [list, setList] = useState<CustomerDto[] | null>(null);
  const [q, setQ] = useState('');
  const [kb, setKb] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const load = () => api<CustomerDto[]>('/api/customers').then(setList).catch((e: Error) => setError(e.message));
  useEffect(() => { load(); }, []);
  useTypedText({ onChar: (c) => setQ((s) => s + c), onBack: () => setQ((s) => s.slice(0, -1)), allowDigits: true });
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (list ?? []).filter((c) => words.every((w) => `${c.name} ${c.phone ?? ''}`.toLowerCase().includes(w))).slice(0, 30);
  const add = async () => {
    const name = q.trim();
    if (!name) return;
    try { const c = await api<CustomerDto>('/api/customers', { cashier, name }); setAdding(false); onPick(c); } catch (e) { setError((e as Error).message); }
  };
  return (
    <Modal title={title} onClose={onClose} wide footer={<>
      {error && <div className="err">{error}</div>}
      {words.length > 0 && shown.length === 0 && !adding && <button className="btn btn-primary btn-block" style={{ minHeight: 54 }} onClick={() => setAdding(true)}>Add "{q.trim()}" as a new customer</button>}
      {adding && <button className="btn btn-primary btn-block" style={{ minHeight: 54 }} onClick={add}>Yes, add {q.trim()} and continue</button>}
    </>}>
      <div className="hint">{hint}</div>
      <div className="quick" style={{ gridTemplateColumns: '1fr auto' }}>
        <div className="display plain" style={{ height: 48, fontSize: 20, justifyContent: 'flex-start', fontWeight: 500 }}>{q || <span style={{ color: 'var(--ink-3)' }}>Type the customer's name…</span>}</div>
        <button className="btn" onClick={() => setKb(!kb)}><Icon name="keyboard" size={20} /></button>
      </div>
      {kb && <OnScreenKeyboard onChar={(c) => setQ((s) => s + c)} onBack={() => setQ((s) => s.slice(0, -1))} onClear={() => setQ('')} onDone={() => setKb(false)} />}
      {list === null && <div className="hint">Loading…</div>}
      {shown.map((c) => (
        <button key={c.id} className="pick" onClick={() => onPick(c)}>
          <b>{c.name}{c.phone ? ` · ${c.phone}` : ''}</b>
          <small>Owes {formatCents(c.balanceCents)}{c.lastAt ? ` · last ${new Date(c.lastAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}` : ''}</small>
        </button>
      ))}
      {list && list.length === 0 && words.length === 0 && <div className="hint">No customers yet. Type a name to add the first one.</div>}
    </Modal>
  );
}

/** Confirms putting the ticket on a customer's tab. */
export function TabChargeModal({ customer, total, busy, error, onClose, onConfirm }: { customer: CustomerDto; total: number; busy: boolean; error: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal title="Put on tab" onClose={onClose}>
      <div className="result good">
        <div className="head"><Icon name="id" size={44} /><div className="big">{customer.name}</div>
          <div className="age">Owes {formatCents(customer.balanceCents)} now · after this {formatCents(customer.balanceCents + total)}</div></div>
      </div>
      <div className="change"><span>This ticket (tax included)</span><span className="num">{formatCents(total)}</span></div>
      <div className="hint">Tax is charged now, with the sale. When they pay the tab later it is just a payment — nothing is taxed again.</div>
      {error && <div className="err">{error}</div>}
      <button className="btn btn-primary btn-block" style={{ minHeight: 62, fontSize: 22 }} disabled={busy} onClick={onConfirm}>Charge {formatCents(total)} to {customer.name}</button>
    </Modal>
  );
}

/** Takes a payment against a customer's tab. */
export function TabPaymentModal({ customer, cashier, onClose, onDone }: { customer: CustomerDto; cashier: string; onClose: () => void; onDone: (balance: number) => void }) {
  const { digits, press, set } = useDigits(8);
  const cents = centsFromKeypadDigits(digits);
  const [tender, setTender] = useState<'cash' | 'card' | 'check'>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pay = async () => {
    if (cents <= 0 || busy) return;
    setBusy(true); setError('');
    try { const r = await api<{ balanceCents: number }>(`/api/customers/${customer.id}/payment`, { cashier, cents, tender }); play('done'); onDone(r.balanceCents); }
    catch (e) { setError((e as Error).message); play('bad'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Pay on tab · ${customer.name}`} onClose={onClose} footer={<>
      {error && <div className="err">{error}</div>}
      <button className="btn btn-primary btn-block" style={{ minHeight: 56, fontSize: 20 }} disabled={cents <= 0 || busy} onClick={pay}>Take {formatCents(cents)} by {tender}</button>
    </>}>
      <div className="change"><span>Owes</span><span className="num">{formatCents(customer.balanceCents)}</span></div>
      <div className="quick" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <button className="btn btn-dark" onClick={() => set(String(Math.max(0, customer.balanceCents)))}>Pay it all</button>
        {[2000, 5000].map((b) => <button key={b} className="btn" onClick={() => set(String(b))}>{formatCents(b).replace('.00', '')}</button>)}
      </div>
      <div className="display num" aria-label="Payment">{formatCents(cents)}</div>
      <Keypad onKey={(k) => (k === '00' ? (press('0'), press('0')) : press(k))} doubleZero onEnter={pay} />
      <div className="chips">
        {(['cash', 'card', 'check'] as const).map((t) => <button key={t} className={`chip ${tender === t ? 'on' : ''}`} onClick={() => setTender(t)}>{t === 'cash' ? 'Cash' : t === 'card' ? 'Card' : 'Check'}</button>)}
      </div>
      <div className="hint">After this they will owe {formatCents(Math.max(0, customer.balanceCents - cents))}. A tab payment is not a sale: no tax.</div>
    </Modal>
  );
}

/** Rename, recolor, move or remove a quick button (manager, in "Edit buttons" mode). */
export function ButtonEditModal({ button, pages, pin, cashier, onClose, onChanged }: { button: ButtonDto; pages: { id: number; name: string }[]; pin: string; cashier: string; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(button.name);
  const [colors, setColors] = useState<string[]>([]);
  const [fill, setFill] = useState(button.fill);
  const [kb, setKb] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api<string[]>('/api/button-colors').then(setColors).catch(() => {}); }, []);
  useTypedText({ onChar: (c) => setName((s) => s + c), onBack: () => setName((s) => s.slice(0, -1)), allowDigits: true });
  const call = async (body: Record<string, unknown>, del = false) => {
    try { await api(del ? `/api/buttons/${button.id}/delete` : `/api/buttons/${button.id}`, { pin, cashier, ...body }); play('ok'); onChanged(); } catch (e) { setError((e as Error).message); play('bad'); }
  };
  return (
    <Modal title="Edit button" onClose={onClose} wide footer={<>
      {error && <div className="err">{error}</div>}
      <div className="quick" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <button className="btn btn-primary" style={{ minHeight: 54 }} disabled={!name.trim()} onClick={() => call({ name, fill })}>Save</button>
        <button className="btn btn-danger" style={{ minHeight: 54 }} onClick={() => call({}, true)}>Remove button</button>
      </div>
    </>}>
      <div className="field-label">NAME ON THE BUTTON{button.itemId ? ' · linked to an inventory item (price and picture follow the item)' : button.priceMode === 'ask' ? ' · asks for the price' : ` · ${formatCents(button.priceCents)}`}</div>
      <div className="quick" style={{ gridTemplateColumns: '1fr auto' }}>
        <div className="display plain" style={{ height: 48, fontSize: 20, justifyContent: 'flex-start', fontWeight: 600 }}>{name}</div>
        <button className="btn" onClick={() => setKb(!kb)}><Icon name="keyboard" size={20} /></button>
      </div>
      {kb && <OnScreenKeyboard onChar={(c) => setName((s) => s + c)} onBack={() => setName((s) => s.slice(0, -1))} onClear={() => setName('')} onDone={() => setKb(false)} />}
      <div className="field-label">COLOR</div>
      <div className="swatches">{colors.map((c) => <button key={c} className={`swatch ${fill === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setFill(c)} aria-label={c} />)}</div>
      <div className="field-label">POSITION</div>
      <div className="quick" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button className="btn" onClick={() => call({ dir: 'left' })}>← Move left</button>
        <button className="btn" onClick={() => call({ dir: 'right' })}>Move right →</button>
      </div>
      {pages.length > 1 && <>
        <div className="field-label">MOVE TO ANOTHER PAGE</div>
        <div className="chips">{pages.map((p) => <button key={p.id} className="chip" onClick={() => call({ pageId: p.id })}>{p.name}</button>)}</div>
      </>}
    </Modal>
  );
}

/** Rename, reorder, or remove a quick page. */
export function PageEditModal({ pageId, name: initial, pin, cashier, onClose, onChanged }: { pageId: number; name: string; pin: string; cashier: string; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(initial);
  const [newName, setNewName] = useState('');
  const [which, setWhich] = useState<'rename' | 'new'>('rename');
  const [error, setError] = useState('');
  const setter = which === 'rename' ? setName : setNewName;
  useTypedText({ onChar: (c) => setter((s) => s + c), onBack: () => setter((s) => s.slice(0, -1)), allowDigits: true });
  const call = async (path: string, body: Record<string, unknown>) => {
    try { await api(path, { pin, cashier, ...body }); play('ok'); onChanged(); } catch (e) { setError((e as Error).message); play('bad'); }
  };
  return (
    <Modal title="Edit page" onClose={onClose} wide footer={<>{error && <div className="err">{error}</div>}</>}>
      <div className="field-label">PAGE NAME</div>
      <div className="quick" style={{ gridTemplateColumns: '1fr auto' }}>
        <button className={`pick ${which === 'rename' ? 'on' : ''}`} onClick={() => setWhich('rename')}><b>{name || '—'}</b></button>
        <button className="btn btn-primary" disabled={!name.trim() || name === initial} onClick={() => call(`/api/pages/${pageId}`, { name })}>Rename</button>
      </div>
      <div className="quick" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
        <button className="btn" onClick={() => call(`/api/pages/${pageId}`, { dir: 'left' })}>← Move page left</button>
        <button className="btn" onClick={() => call(`/api/pages/${pageId}`, { dir: 'right' })}>Move page right →</button>
        <button className="btn btn-danger" onClick={() => call(`/api/pages/${pageId}/delete`, {})}>Remove page</button>
      </div>
      <div className="field-label">ADD A NEW PAGE</div>
      <div className="quick" style={{ gridTemplateColumns: '1fr auto' }}>
        <button className={`pick ${which === 'new' ? 'on' : ''}`} onClick={() => setWhich('new')}><b>{newName || <span style={{ color: 'var(--ink-3)' }}>Type a name…</span>}</b></button>
        <button className="btn btn-primary" disabled={!newName.trim()} onClick={() => call('/api/pages', { name: newName })}>Add page</button>
      </div>
      <OnScreenKeyboard onChar={(c) => setter((s) => s + c)} onBack={() => setter((s) => s.slice(0, -1))} onClear={() => setter('')} />
    </Modal>
  );
}

/** Manual item: amount + tax group (+ category) for things not in the system. Never asks for ID. */
export function ManualItemModal({ authorities, onClose, onAdd }: { authorities: Authority[]; onClose: () => void; onAdd: (cents: number, authorityId: number | null) => void }) {
  const { digits, press } = useDigits(7);
  const cents = centsFromKeypadDigits(digits);
  const guess = authorities.find((a) => /grocery|all/i.test(a.title)) ?? authorities[0] ?? null;
  const [authorityId, setAuthorityId] = useState<number | null>(guess?.id ?? null);
  const go = () => { if (cents > 0) onAdd(cents, authorityId); };
  return (
    <Modal title="Manual item" onClose={onClose} wide footer={
      <button className="btn btn-primary btn-block" style={{ minHeight: 56, fontSize: 20 }} disabled={cents <= 0} onClick={go}>Add {formatCents(cents)} · {authorityId === null ? 'no tax' : authorities.find((a) => a.id === authorityId)?.title}</button>}>
      <div className="field-label">TAX GROUP</div>
      <div className="chips">
        {authorities.map((a) => <button key={a.id} className={`chip ${authorityId === a.id ? 'on' : ''}`} onClick={() => setAuthorityId(a.id)}>{a.title}{a.rateBp !== null ? ` ${a.rateBp % 100 === 0 ? a.rateBp / 100 : (a.rateBp / 100).toFixed(2)}%` : ''}</button>)}
        <button className={`chip ${authorityId === null ? 'on' : ''}`} onClick={() => setAuthorityId(null)}>No tax</button>
      </div>
      <div className="field-label">AMOUNT</div>
      <div className="display num">{formatCents(cents)}</div>
      <Keypad onKey={(k) => (k === '00' ? (press('0'), press('0')) : press(k))} doubleZero onEnter={go} />
    </Modal>
  );
}
