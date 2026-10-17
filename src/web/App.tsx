import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatCents } from '../core/money';
import { looksLikeId, parseIdForAge } from '../core/aamva';
import { computeTotals, dealLabel, type TicketLine, checkFeeLabel } from '../core/ticket';
import type { Bootstrap, ButtonDto, CustomerDto, HoldDto, ItemDto, Receipt, SaleLineInput } from '../core/types';
import { ApiError, api } from './api';
import {
  AskModal, CardModal, CashModal, ConfirmModal, DiscountModal, DobModal, IdModal, LinkModal, LotteryModal, PayoutModal,
  CheckModal, CustomerPickModal, NewItemModal, PinModal, PowerModal, QtyModal, TabChargeModal, TabPaymentModal, RecallModal, ReceiptModal, TodayModal, type AgeInfo, type Lookup,
} from './modals';
import { Icon, Keypad, OnScreenKeyboard, Shape } from './parts';
import { InventoryPage, imageUrl } from './inventory';
import { ManagePage } from './manage';
import { installTapSound, play, setSoundsEnabled, soundsEnabled } from './sounds';
import { CategoryArt } from './art';

type ModalState =
  | { t: 'power' } | { t: 'cash' } | { t: 'card' } | { t: 'check' } | { t: 'gas' }
  | { t: 'tabpick' } | { t: 'tabcharge'; customer: CustomerDto } | { t: 'tabpaypick' } | { t: 'tabpay'; customer: CustomerDto } | { t: 'lottery' } | { t: 'payout' } | { t: 'id' } | { t: 'dob' } | { t: 'recall' }
  | { t: 'discount' } | { t: 'today' }
  | { t: 'ask'; button: ButtonDto }
  | { t: 'qty'; key: string }
  | { t: 'link'; code: string; lookup?: Lookup | null }
  | { t: 'newitem'; code: string; lookup: Lookup | null }
  | { t: 'pin'; title: string; hint: string; then: (pin: string) => void }
  | { t: 'confirm'; title: string; message: string; yes: string; onYes: () => void }
  | { t: 'receipt'; receipt: Receipt };

type User = { name: string; role: string; pin: string };

let seq = 0;
const newKey = () => `k${++seq}`;

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [loadError, setLoadError] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [lines, setLines] = useState<TicketLine[]>([]);
  const [discountPct, setDiscountPct] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [pageId, setPageId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [kb, setKb] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  useEffect(() => { modalRef.current = modal; if (!modal) searchRef.current?.focus(); }, [modal]);
  const [ageInfo, setAgeInfo] = useState<AgeInfo | null>(null);
  const [holds, setHolds] = useState<HoldDto[]>([]);
  const [toast, setToast] = useState<{ msg: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [payError, setPayError] = useState('');
  const [linkError, setLinkError] = useState('');
  const [inventory, setInventory] = useState<string | null>(null);
  const [manage, setManage] = useState<string | null>(null);
  const [sounds, setSounds] = useState(soundsEnabled());
  const [updateReady, setUpdateReady] = useState<string | null>(null);
  const [updatePending, setUpdatePending] = useState<string | null>(null); // installed on disk, waiting for a restart
  const [updating, setUpdating] = useState<string | null>(null); // progress text while the Update button works

  // Tell the register program this screen is showing (so a second launch focuses it instead of opening another).
  useEffect(() => {
    let es: EventSource | null = null; let retry: number | undefined;
    const connect = () => { es = new EventSource('/api/register/events'); es.onerror = () => { es?.close(); retry = window.setTimeout(connect, 3000); }; };
    connect();
    return () => { es?.close(); window.clearTimeout(retry); };
  }, []);

  // Tell the register program whether a ticket is open, so it never restarts for an update mid-sale.
  useEffect(() => {
    const open = lines.length > 0;
    api('/api/activity', { ticketOpen: open }).catch(() => {});
    if (!open) return;
    const t = window.setInterval(() => api('/api/activity', { ticketOpen: true }).catch(() => {}), 60_000);
    return () => window.clearInterval(t);
  }, [lines.length > 0]);

  // After the program updates itself, reload this screen as soon as the ticket is empty.
  useEffect(() => {
    if (!boot) return;
    const t = window.setInterval(async () => {
      try {
        const v = (await api<{ version: string }>('/api/version')).version;
        if (v !== boot.version) setUpdateReady(v);
        const st = await api<{ pending: string | null }>('/api/update/status');
        setUpdatePending(st.pending && st.pending !== boot.version ? st.pending : null);
      } catch { /* the program is restarting; try again shortly */ }
    }, 20_000);
    return () => window.clearInterval(t);
  }, [boot]);
  useEffect(() => {
    if (updateReady && (updating || (lines.length === 0 && !modal))) window.setTimeout(() => window.location.reload(), 1500);
  }, [updateReady, lines.length, modal, updating]);
  useEffect(() => installTapSound(), []); // manager PIN while the inventory page is open
  const invScan = useRef<((code: string) => void) | null>(null);
  const tap = useRef({ id: '', t: 0 });
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = () => { if (!modalRef.current) searchRef.current?.focus(); };
  const modalRef = useRef<ModalState | null>(null);
  const manualPin = useRef<string | undefined>(undefined);

  const isMgr = user?.role === 'manager' || user?.role === 'owner';
  /** Managers and owners act on their own login; cashiers are asked for a manager's PIN. */
  const withPin = (title: string, hint: string, then: (pin: string) => void) => {
    if (isMgr && user) then(user.pin);
    else setModal({ t: 'pin', title, hint, then: (p) => { setModal(null); then(p); } });
  };

  const showToast = useCallback((msg: string, bad = false) => {
    setToast({ msg, bad });
    if (bad) play('bad');
    window.setTimeout(() => setToast((t) => (t && t.msg === msg ? null : t)), 3200);
  }, []);

  const refreshHolds = useCallback(async () => {
    try { setHolds(await api<HoldDto[]>('/api/holds')); } catch { /* shown elsewhere */ }
  }, []);

  useEffect(() => {
    api<Bootstrap>('/api/bootstrap').then((b) => { setBoot(b); setPageId(b.pages[0]?.id ?? null); }).catch((e: Error) => setLoadError(e.message));
    refreshHolds();
  }, [refreshHolds]);

  const authorities = boot?.authorities ?? [];
  const { totals, perLine } = useMemo(() => computeTotals(lines, authorities, discountPct), [lines, authorities, discountPct]);
  const lineAmt = useMemo(() => new Map(perLine.map((p) => [p.key, p])), [perLine]);
  const authById = useMemo(() => new Map(authorities.map((a) => [a.id, a])), [authorities]);

  const required = totals.ageRequired;
  const ageStatus: 'none' | 'needed' | 'passed' | 'under' | 'expired' = (() => {
    if (required === null) return 'none';
    if (!ageInfo) return 'needed';
    if (ageInfo.method === 'manager_override') return 'passed';
    if (ageInfo.ageYears !== null && ageInfo.ageYears < required) return 'under';
    if (ageInfo.expired) return 'expired';
    return 'passed';
  })();
  const canPay = lines.length > 0 && (ageStatus === 'none' || ageStatus === 'passed');
  // Checks being cashed on this ticket: the customer pays with them and gets the rest back in cash.
  const checkCents = lines.filter((l) => l.kind === 'service' && l.service === 'check_fee').reduce((s, l) => s + (l.baseCents ?? 0), 0);
  const checkCashBack = checkCents - totals.totalCents;

  // Customer screen: mirror the ticket as it changes, and the result after a sale.
  useEffect(() => {
    if (!boot) return;
    const receipt = modal?.t === 'receipt' ? modal.receipt : null;
    const body = receipt
      ? { mode: 'paid', lines: [], subtotalCents: receipt.totals.subtotalCents, taxCents: receipt.totals.taxCents, discountCents: receipt.totals.discountCents,
          totalCents: receipt.totals.totalCents, tender: receipt.payment.tender, tenderedCents: receipt.payment.tenderedCents ?? undefined, changeCents: receipt.payment.changeCents ?? 0, customerName: receipt.payment.customerName ?? undefined }
      : lines.length === 0
        ? { mode: 'idle' }
        : { mode: 'ticket', lines: lines.map((l) => ({ name: l.name, qty: l.qty, cents: lineAmt.get(l.key)?.grossCents ?? l.unitCents * l.qty })),
            subtotalCents: totals.subtotalCents, taxCents: totals.taxCents, discountCents: totals.discountCents, totalCents: totals.totalCents };
    const t = window.setTimeout(() => { api('/api/display', body).catch(() => {}); }, 80);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot, lines, totals, modal?.t === 'receipt' ? modal.receipt : null]);


  const tapOk = (id: string) => {
    // A scanner's Enter key would "click" whichever button still has focus, so move focus to the search box after every tap.
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.setTimeout(focusSearch, 0);
    const now = performance.now();
    if (tap.current.id === id && now - tap.current.t < 180) return false; // ignore accidental double-taps
    tap.current = { id, t: now };
    return true;
  };

  // ---------- ticket editing ----------
  const confirmQty = (nextQty: number, apply: () => void) => {
    if (boot && nextQty > boot.settings.warnQty) {
      setModal({ t: 'confirm', title: 'Large quantity', message: `Quantity is ${nextQty}. Are you sure?`, yes: 'Yes, that is right', onYes: () => { apply(); setModal(null); } });
    } else apply();
  };

  const pushLine = (nl: Omit<TicketLine, 'key'>) => {
    play('ok');
    // Each scan or tap is its own line on the ticket (two cases of beer show as two lines), like the old register.
    const existing = null as TicketLine | null;
    if (existing) {
      confirmQty(existing.qty + nl.qty, () => setLines((ls) => ls.map((l) => (l.key === existing.key ? { ...l, qty: l.qty + nl.qty } : l))));
      setSel(existing.key);
    } else {
      const key = newKey();
      setLines((ls) => [...ls, { ...nl, key }]);
      setSel(key);
    }
  };

  const addItem = (it: ItemDto) => {
    if (!tapOk(`i${it.id}`)) return;
    pushLine({ kind: 'item', name: it.size ? `${it.name} ${it.size}` : it.name, qty: 1, unitCents: it.priceCents, authorityId: it.authorityId,
      category: it.category, ageMin: it.ageMin, itemId: it.id, dealQty: it.dealQty, dealCents: it.dealCents });
  };

  const tapButton = (b: ButtonDto) => {
    if (!tapOk(`b${b.id}`)) return;
    if (b.priceMode === 'ask') { setModal({ t: 'ask', button: b }); return; }
    pushLine({ kind: 'button', name: b.name, qty: 1, unitCents: b.priceCents, authorityId: b.authorityId, category: b.category, ageMin: b.ageMin, buttonId: b.id });
  };

  const changeQty = (key: string, delta: number) => {
    const l = lines.find((x) => x.key === key);
    if (!l) return;
    const q = l.qty + delta;
    if (q < 1) { setLines((ls) => ls.filter((x) => x.key !== key)); setSel(null); return; }
    confirmQty(q, () => setLines((ls) => ls.map((x) => (x.key === key ? { ...x, qty: q } : x))));
  };

  const clearTicket = () => { setLines([]); setDiscountPct(0); setSel(null); setAgeInfo(null); setPayError(''); };

  // ---------- scanner ----------
  const handleScan = async (raw: string) => {
    if (!boot || !user) return;
    const text = raw.replace(/\s+$/, '');
    if (looksLikeId(text)) {
      setSearch('');
      const r = parseIdForAge(text);
      if (!r.ok) { showToast(r.reason, true); return; }
      setAgeInfo({ method: 'scan', ageYears: r.ageYears, expired: r.expired });
      if (required !== null || modal?.t === 'id') setModal({ t: 'id' });
      else if (r.expired) showToast(`ID is expired. Customer is ${r.ageYears}.`, true);
      else if (r.ageYears >= 21) showToast(`APPROVED — customer is ${r.ageYears} (21+). Covers this ticket.`);
      else if (r.ageYears >= 18) showToast(`Customer is ${r.ageYears}: OK for 18+ tobacco, NOT for alcohol.`, true);
      else showToast(`UNDER AGE — customer is ${r.ageYears}.`, true);
      return;
    }
    const code = text.trim();
    if (invScan.current) { if (code.length >= 4) invScan.current(code); return; }
    if (modal && modal.t !== 'id') return; // finish the open screen first
    if (code.length < 4) return;
    setSearch('');
    try {
      const { itemId } = await api<{ itemId: number }>(`/api/scan/${encodeURIComponent(code)}`);
      const it = boot.items.find((i) => i.id === itemId);
      if (it) addItem({ ...it });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setLinkError(''); setModal({ t: 'link', code });
        // Ask the open product database in the background; fill the card in when it answers.
        api<Lookup>(`/api/lookup/${encodeURIComponent(code)}`).then((lk) => {
          setModal((m) => (m && m.t === 'link' && m.code === code ? { ...m, lookup: lk } : m));
        }).catch(() => setModal((m) => (m && m.t === 'link' && m.code === code ? { ...m, lookup: null } : m)));
      }
      else showToast((e as Error).message, true);
    }
  };
  const scanRef = useRef(handleScan);
  scanRef.current = handleScan;

  useEffect(() => {
    // USB scanners type like a very fast keyboard. A burst of keys with tiny gaps, then a pause, is a scan.
    let buf = '';
    let last = 0;
    let maxGap = 0;
    let idMode = false; // an ID barcode is coming in: it is long, may arrive slowly, and must not reach the search box
    let timer: number | undefined;
    const flush = () => {
      const text = buf;
      const fast = maxGap < 80;
      const wasId = idMode;
      buf = ''; maxGap = 0; idMode = false;
      if (wasId) { scanRef.current(text); return; }
      if (text.trim().length >= 4 && fast) scanRef.current(text);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      let ch = '';
      if (e.key.length === 1) ch = e.key;
      else if (e.key === 'Enter') ch = '\n';
      else if (e.key === 'Tab' && idMode) ch = '\t';
      else return;
      // A number pad on screen (PIN, cash, price…) owns the digits and Enter; a fast typist is not a scanner.
      if (!idMode && document.querySelector('.keypad')) { buf = ''; maxGap = 0; return; }
      const now = performance.now();
      if (!idMode && buf && now - last > 200) { buf = ''; maxGap = 0; }
      if (buf) maxGap = Math.max(maxGap, now - last);
      buf += ch;
      last = now;
      // The barcode on the back of a license starts with "@" and soon says "ANSI". Once we see that, swallow every key
      // until the scanner pauses, whatever the typing speed.
      if (!idMode && (buf === '@' || buf === 'ID:' || buf.endsWith('ANSI'))) idMode = true;
      if (idMode) {
        e.preventDefault(); e.stopPropagation();
        if (!buf.startsWith('@') && !buf.startsWith('ID:') && !buf.includes('ANSI')) idMode = false;
        window.clearTimeout(timer);
        timer = window.setTimeout(flush, 500);
        return;
      }
      // Typing with nothing focused (or a button focused) goes into the search box.
      const ae = document.activeElement as HTMLElement | null;
      const typingTarget = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA');
      if (!typingTarget && ch !== '\n' && !modalRef.current) searchRef.current?.focus();
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, 120);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // ---------- actions ----------
  const startPay = (t: 'cash' | 'card') => {
    if (!boot || !canPay) return;
    setPayError('');
    const go = () => setModal({ t });
    if (totals.totalCents > boot.settings.warnTotalCents) {
      setModal({ t: 'confirm', title: 'Large sale', message: `The total is ${formatCents(totals.totalCents)}. Are you sure?`, yes: 'Yes, continue', onYes: go });
    } else go();
  };

  const toInput = (l: TicketLine): SaleLineInput => {
    if (l.kind === 'item') return { kind: 'item', itemId: l.itemId ?? undefined, qty: l.qty };
    if (l.kind === 'lottery') return { kind: 'lottery', qty: l.qty, unitCents: l.unitCents };
    if (l.kind === 'ask') return { kind: 'ask', buttonId: l.buttonId ?? undefined, qty: l.qty, unitCents: l.unitCents };
    if (l.kind === 'service') return { kind: 'service', service: l.service, qty: 1, unitCents: l.unitCents, baseCents: l.baseCents };
    return { kind: 'button', buttonId: l.buttonId ?? undefined, qty: l.qty };
  };

  const completeSale = async (payment: { tender: 'cash' | 'card' | 'check' | 'tab'; tenderedCents?: number; reference?: string; customerId?: number }, extraLines: TicketLine[] = []) => {
    if (!user) return;
    setBusy(true); setPayError('');
    try {
      const receipt = await api<Receipt>('/api/sales', {
        cashier: user.name, discountPct, lines: [...lines, ...extraLines].map(toInput), payment,
        ageCheck: required !== null && ageInfo ? { method: ageInfo.method, result: 'passed', managerPin: ageInfo.managerPin } : undefined,
      });
      play('done');
      setModal({ t: 'receipt', receipt });
    } catch (e) { setPayError((e as Error).message); }
    finally { setBusy(false); }
  };

  const holdTicket = async () => {
    if (!user) return;
    if (lines.length === 0) { showToast('Add something to the ticket first.', true); return; }
    try {
      const r = await api<{ label: string }>('/api/holds', { cashier: user.name, lines, discountPct });
      clearTicket(); await refreshHolds(); showToast(`Held as ${r.label}.`);
    } catch (e) { showToast((e as Error).message, true); }
  };

  const openRecall = async () => { await refreshHolds(); setModal({ t: 'recall' }); };

  const recall = async (h: HoldDto) => {
    if (!user) return;
    if (lines.length > 0) { showToast('Finish or hold the current ticket first.', true); return; }
    try {
      await api(`/api/holds/${h.id}?cashier=${encodeURIComponent(user.name)}`, undefined, 'DELETE');
      setLines((h.lines as TicketLine[]).map((l) => ({ ...l, key: newKey() })));
      setDiscountPct(h.discountPct); setAgeInfo(null); setModal(null); await refreshHolds();
    } catch (e) { showToast((e as Error).message, true); await refreshHolds(); }
  };

  /** Refresh / restart / shut down, for when something looks stuck. */
  const power = async (action: 'refresh' | 'restart' | 'quit' | 'reboot' | 'poweroff') => {
    if (action === 'refresh') { window.location.reload(); return; }
    setModal(null);
    try { await api('/api/power', { action, cashier: user?.name ?? '' }); } catch { /* the register may already be down; the launcher brings it back */ }
    if (action === 'restart') {
      setUpdating('Restarting…');
      // Wait for the register to go away and come back, then reload this screen.
      let wasDown = false;
      const t = window.setInterval(async () => {
        try { await api('/api/version'); if (wasDown) { window.clearInterval(t); window.location.reload(); } }
        catch { wasDown = true; }
      }, 1000);
      window.setTimeout(() => { window.clearInterval(t); window.location.reload(); }, 60_000);
    } else {
      setUpdating(action === 'quit' ? 'Closing…' : action === 'reboot' ? 'Restarting the computer…' : 'Shutting down…');
    }
  };

  /** One tap: check for a newer build, install it, restart. The screen reloads itself when the register is back. */
  const runUpdate = async () => {
    if (!user) return;
    const go = async () => {
      setModal(null);
      try {
        if (!updatePending) {
          setUpdating('Checking…');
          const st = await api<{ state: string; message: string; latest: string | null; current: string; pending: string | null }>('/api/update/check', { cashier: user.name });
          if (st.state === 'up-to-date') { setUpdating(null); showToast(`Up to date (v${st.current}).`); return; }
          if (st.state === 'error') { setUpdating(null); showToast(st.message, true); return; }
          if (!st.pending) { setUpdating(null); showToast(st.message); return; }
          setUpdating(`Installing ${st.pending}…`);
        } else setUpdating(`Installing ${updatePending}…`);
        await api('/api/update/restart', { cashier: user.name });
        showToast('Restarting with the update… the screen comes back by itself.');
      } catch (e) { setUpdating(null); showToast((e as Error).message, true); }
    };
    if (lines.length > 0) setModal({ t: 'confirm', title: 'Update now?', message: 'The ticket on screen will be lost. Hold it first if you need it.', yes: 'Update anyway', onYes: go });
    else go();
  };

  const noSale = async (pin?: string) => {
    if (!user) return;
    try {
      const r = await api<{ drawer: string; message?: string }>('/api/no-sale', { cashier: user.name, pin });
      if (r.drawer === 'opened') showToast('Register opened (No Sale).');
      else if (r.drawer === 'no-printer') showToast('No Sale recorded. Set up the cash drawer under Manage → Printer so the register can open.', true);
      else showToast(`No Sale recorded, but the drawer did not open: ${r.message ?? 'printer problem'}`, true);
      setModal(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        withPin('Manager PIN', 'A manager PIN is needed to open the drawer without a sale.', (p) => noSale(p));
      } else showToast((e as Error).message, true);
    }
  };

  const [newItemBusy, setNewItemBusy] = useState(false);
  const saveNewItem = async (code: string, item: { name: string; size: string | null; priceCents: number; category: string; authorityId: number | null; ageMin: number | null; imageUrl: string | null }, pin?: string) => {
    if (!user || !boot) return;
    const p = pin ?? (isMgr ? user.pin : undefined);
    if (!p) { withPin('Manager PIN', 'A manager PIN is needed to add a new item.', (pp) => saveNewItem(code, item, pp)); return; }
    setNewItemBusy(true); setLinkError('');
    try {
      const it = await api<ItemDto>('/api/items/quick', { ...item, code, pin: p, cashier: user.name });
      setBoot({ ...boot, items: [...boot.items, it] });
      setModal(null);
      addItem({ ...it });
      showToast(`${it.name} added. It will scan straight in next time.`);
    } catch (e) { setLinkError((e as Error).message); }
    finally { setNewItemBusy(false); }
  };

  const linkBarcode = async (code: string, itemId: number) => {
    if (!user || !boot) return;
    try {
      await api('/api/barcodes/link', { code, itemId, cashier: user.name });
      setBoot({ ...boot, items: boot.items.map((i) => (i.id === itemId ? { ...i, hasBarcode: true } : i)) });
      const it = boot.items.find((i) => i.id === itemId);
      setModal(null);
      if (it) addItem({ ...it });
      showToast('Barcode saved. It will scan straight in next time.');
    } catch (e) { setLinkError((e as Error).message); }
  };

  const removeRestricted = () => {
    const age = ageInfo?.ageYears ?? 0;
    setLines((ls) => ls.filter((l) => l.ageMin === null || l.ageMin <= age));
    if (user) api('/api/audit', { cashier: user.name, action: 'id_check_refused', detail: `needs ${required}+` }).catch(() => undefined);
    setModal(null); setSel(null);
  };

  const startManual = () => {
    if (!boot) return;
    if (boot.settings.scanIdOnly) {
      withPin('Manager PIN', 'Typing a birth date needs a manager PIN while Scan ID only is on.', (pin) => { manualPin.current = pin; setModal({ t: 'dob' }); });
    } else { manualPin.current = undefined; setModal({ t: 'dob' }); }
  };

  const startOverride = () => {
    withPin('Manager PIN', 'A manager is approving this sale after checking the ID by hand.', (pin) => {
      setAgeInfo({ method: 'manager_override', ageYears: null, expired: false, managerPin: pin }); setModal({ t: 'id' });
    });
  };

  // ---------- render ----------
  if (loadError) return <div className="login"><div className="modal"><h2>Cannot start</h2><div className="err">{loadError}</div></div></div>;
  if (!boot) return <div className="login"><div className="hint">Loading…</div></div>;
  if (!user) return <Login store={boot.store.name} version={boot.version} onLogin={setUser} />;

  const page = boot.pages.find((p) => p.id === pageId) ?? boot.pages[0];
  const allButtons = boot.pages.flatMap((p) => p.buttons);
  const btnByName = (n: string) => allButtons.find((b) => b.name === n);
  const q = search.trim().toLowerCase();
  const results = q
    ? boot.items.filter((i) => q.split(/\s+/).every((w) => `${i.name} ${i.size ?? ''} ${i.category}`.toLowerCase().includes(w))).slice(0, 24)
    : [];
  const frequent = boot.items.filter((i) => i.frequent).slice(0, 6);
  const pctLabel = (id: number | null) => {
    const a = id === null ? undefined : authById.get(id);
    if (!a) return 'No tax';
    return a.rateBp !== null ? `${a.title} ${a.rateBp / 100}%` : `${a.title} ${formatCents(a.flatCents ?? 0)}`;
  };

  if (manage) {
    return <ManagePage pin={manage} cashier={user.name} version={boot.version} onClose={() => setManage(null)} />;
  }
  if (inventory) {
    return <InventoryPage authorities={boot.authorities} cashier={user.name} pin={inventory} version={boot.version} trackStock={boot.settings.trackStock} scanRef={invScan}
      onClose={() => setInventory(null)} onChanged={() => api<Bootstrap>('/api/bootstrap').then(setBoot).catch(() => {})} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div><span className="brand">{boot.store.name}</span><span className="sub">Register 1</span><span className="sub" data-testid="version">v{boot.version}</span></div>
        <div className="topbar-right">
          {updateReady && <span className="pill" style={{ background: '#1c4a3c', color: '#bff0dc' }}>Update {updateReady} ready</span>}
          {!updateReady && (
            <button className="btn btn-sm" disabled={!!updating} style={{ background: updatePending ? '#1c4a3c' : 'transparent', color: updatePending ? '#bff0dc' : '#fff', borderColor: updatePending ? '#2f7a5c' : '#3a5266' }}
              onClick={() => runUpdate()}>
              <Icon name="upload" size={18} /> {updating ?? (updatePending ? `Install ${updatePending}` : 'Update')}
            </button>
          )}
          <span className="pill">Cashier: {user.name}</span>
          <button className="btn btn-sm" title="Refresh, restart or shut down" style={{ background: 'transparent', color: '#fff', borderColor: '#3a5266' }} onClick={() => setModal({ t: 'power' })}>
            <Icon name="power" size={20} />
          </button>
          {isMgr && <button className="btn btn-sm" style={{ background: 'transparent', color: '#fff', borderColor: '#3a5266' }} onClick={() => setInventory(user.pin)}>
            <Icon name="box" size={20} /> Inventory
          </button>}
          {isMgr && <button className="btn btn-sm" style={{ background: 'transparent', color: '#fff', borderColor: '#3a5266' }} onClick={() => setManage(user.pin)}>
            <Icon name="settings" size={20} /> Manage
          </button>}
          <button className="btn btn-sm" style={{ background: 'transparent', color: '#fff', borderColor: '#3a5266' }} onClick={() => setModal({ t: 'today' })}>
            <Icon name="report" size={20} /> Today
          </button>
          <button className="btn btn-sm" aria-label={sounds ? 'Turn sounds off' : 'Turn sounds on'} aria-pressed={sounds} style={{ background: 'transparent', color: '#fff', borderColor: '#3a5266' }} onClick={() => { setSoundsEnabled(!sounds); setSounds(!sounds); }}>
            <Icon name={sounds ? 'sound' : 'mute'} size={20} />
          </button>
          <button className="btn btn-sm" aria-label="Lock screen" style={{ background: 'transparent', color: '#fff', borderColor: '#3a5266' }} onClick={() => setUser(null)}>
            <Icon name="lock" size={20} />
          </button>
        </div>
      </header>

      <div className="main">
        <section className="left" aria-label="Ticket">
          <div className="left-head">
            <h2>Ticket</h2>
            {discountPct > 0 && <span className="pill" style={{ background: '#e4e7ea', color: 'var(--ink)' }}>{discountPct}% off</span>}
          </div>
          <div className="lines">
            {lines.length === 0 && <div className="empty-ticket">Scan an item or tap a button to start a sale.</div>}
            {lines.map((l) => {
              const amt = lineAmt.get(l.key);
              const on = sel === l.key;
              return (
                <div key={l.key}>
                  <button className={`line ${on ? 'sel' : ''}`} onClick={() => setSel(on ? null : l.key)}>
                    <span className="nm">
                      {l.name}{l.ageMin !== null && <span className="age-tag">{l.ageMin}+</span>}
                      <span className="meta">
                        {l.kind === 'lottery' ? 'No tax · counted separately' : `${pctLabel(l.authorityId)} · ${l.qty} × ${formatCents(l.unitCents)}`}
                        {l.dealQty && l.dealCents !== null && l.dealCents !== undefined && <span className="deal-tag">{dealLabel(l.dealQty, l.dealCents)}{(amt?.discountCents ?? 0) > 0 ? ` · −${formatCents(amt!.discountCents)}` : ''}</span>}
                      </span>
                    </span>
                    <span className="amt num">{(amt?.discountCents ?? 0) > 0 && discountPct === 0
                      ? <><s style={{ color: 'var(--ink-3)', fontWeight: 400, fontSize: 15, marginRight: 6 }}>{formatCents(amt!.grossCents)}</s>{formatCents(amt!.netCents)}</>
                      : formatCents(amt?.grossCents ?? 0)}</span>
                  </button>
                  {on && (
                    <div className="line-tools">
                      {l.kind !== 'lottery' && <>
                        <button className="btn tool" aria-label="Less" onClick={() => changeQty(l.key, -1)}>−</button>
                        <button className="btn tool" aria-label="More" onClick={() => changeQty(l.key, 1)}>+</button>
                        <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => setModal({ t: 'qty', key: l.key })}>Qty…</button>
                      </>}
                      <button className="btn btn-sm btn-danger" style={{ flex: 1 }} onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); setSel(null); }}>Remove</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="totals">
            <div className="row"><span>Subtotal</span><span className="num">{formatCents(totals.subtotalCents)}</span></div>
            {totals.discountCents > 0 && <div className="row"><span>Discount {discountPct}%</span><span className="num">-{formatCents(totals.discountCents)}</span></div>}
            {totals.taxLines.map((t) => <div key={t.authorityId} className="row small"><span>{t.title}</span><span className="num">{formatCents(t.cents)}</span></div>)}
            <div className="grand"><span>Total</span><span className="num" data-testid="total">{formatCents(totals.totalCents)}</span></div>
          </div>

          {ageStatus !== 'none' && (
            <div className={`age-banner ${ageStatus === 'passed' ? 'ok' : ageStatus === 'under' ? 'bad' : ''}`} data-testid="age-banner">
              <Icon name={ageStatus === 'under' ? 'ban' : ageStatus === 'passed' ? 'ok' : 'id'} size={32} />
              <div className="t">
                <b>{ageStatus === 'needed' ? 'ID REQUIRED' : ageStatus === 'passed' ? `APPROVED · ${required}+` : ageStatus === 'under' ? 'UNDER AGE · DO NOT SELL' : 'ID EXPIRED'}</b>
                <span>{ageStatus === 'needed' ? 'Scan the back of the ID to continue' : ageStatus === 'passed'
                  ? (ageInfo?.method === 'manager_override' ? 'Approved by a manager' : `Customer is ${ageInfo?.ageYears}`)
                  : ageStatus === 'under' ? `Customer is ${ageInfo?.ageYears}. Needs ${required}+` : 'Manager must approve'}</span>
              </div>
              <button className="btn btn-dark btn-sm" onClick={() => setModal({ t: 'id' })}>{ageStatus === 'needed' ? 'Scan ID' : 'Details'}</button>
            </div>
          )}

          {checkCents > 0 && (
            <div className="pay" style={{ paddingBottom: 0 }}>
              <button className="btn btn-dark" style={{ flex: 1, minHeight: 64, display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', textAlign: 'left', padding: '0 16px' }} disabled={!canPay || checkCashBack < 0}
                onClick={() => { if (!canPay) return; setPayError(''); completeSale({ tender: 'check', tenderedCents: checkCents }); }}>
                <span style={{ fontSize: 20 }}>CHECK {formatCents(checkCents)}</span>
                <span style={{ fontWeight: 500, fontSize: 15, textAlign: 'right', lineHeight: 1.1 }}>{checkCashBack >= 0 ? <>cash to customer<br /><b style={{ fontSize: 18 }}>{formatCents(checkCashBack)}</b></> : 'check does not cover the ticket'}</span>
              </button>
            </div>
          )}
          <div className="pay">
            <button className="btn btn-primary" disabled={!canPay} onClick={() => startPay('cash')}>CASH</button>
            <button className="btn btn-primary" disabled={!canPay} onClick={() => startPay('card')}>CARD</button>
            <button className="btn btn-dark" style={{ flex: 0.7 }} disabled={!canPay} onClick={() => { if (!canPay) return; setPayError(''); setModal({ t: 'tabpick' }); }}>TAB</button>
          </div>
          {lines.length > 0 && (
            <div className="cancel-row">
              <button className="btn btn-sm btn-danger btn-block" onClick={() => setModal({ t: 'confirm', title: 'Cancel this sale?', message: 'Everything on the ticket will be removed.', yes: 'Cancel the sale', onYes: () => {
                if (user) api('/api/audit', { cashier: user.name, action: 'void_ticket', detail: `${lines.length} lines, ${totals.totalCents}` }).catch(() => undefined);
                clearTicket(); setModal(null);
              } })}>Cancel sale</button>
            </div>
          )}
        </section>

        <section className="right" aria-label="Products">
          <div className="searchrow">
            <label className="searchbox">
              <Icon name="search" />
              <input ref={searchRef} autoFocus value={search} onChange={(e) => setSearch(e.target.value)} inputMode="none" placeholder="Search by name, or just scan a barcode" aria-label="Search" />
              {search && <button className="btn btn-quiet btn-sm" onClick={() => setSearch('')}>Clear</button>}
            </label>
            <button className="btn" onClick={() => setKb(!kb)}><Icon name="keyboard" /> Keyboard</button>
          </div>

          {!q && (
            <div className="tabs" role="tablist">
              {boot.pages.map((p) => (
                <button key={p.id} role="tab" aria-selected={p.id === page?.id} className={`tab ${p.id === page?.id ? 'on' : ''}`} onClick={() => setPageId(p.id)}>{p.name}</button>
              ))}
            </div>
          )}

          <div className="grid-wrap">
            {q ? (
              <div className="items">
                {results.map((i) => (
                  <button key={i.id} className="item" onClick={(e) => { if (e.detail === 0) return; addItem(i); }}>
                    {imageUrl(i.id, i.imageVersion) ? <img className="ph ph-img" src={imageUrl(i.id, i.imageVersion)!} alt="" /> : <div className="ph" style={{ background: i.color }}><CategoryArt category={i.category} name={i.name} size={40} /></div>}
                    <div className="nm">{i.name}{i.size ? ` ${i.size}` : ''}{i.ageMin !== null && <span className="age-tag">{i.ageMin}+</span>}</div>
                    <div className="pr num">{formatCents(i.priceCents)}{i.dealQty && i.dealCents !== null && <span className="deal-tag">{dealLabel(i.dealQty, i.dealCents)}</span>}</div>
                  </button>
                ))}
                {results.length === 0 && <div className="empty-page" style={{ gridColumn: '1 / -1' }}>No items match “{search}”.</div>}
              </div>
            ) : (
              <div className="tiles">
                {page?.buttons.map((b) => (
                  <button key={b.id} className={`tile ${b.priceMode === 'ask' ? 'tile-ask' : ''}`} style={{ background: b.fill, borderColor: b.border, color: b.textColor }} onClick={(e) => { if (e.detail === 0) return; tapButton(b); }}>
                    {b.ageMin !== null && <span className="age-tag">{b.ageMin}+</span>}
                    <Shape shape={b.shape} />
                    <span>
                      <span className="nm" style={{ display: 'block' }}>{b.name}</span>
                      <span className="pr num">{b.priceMode === 'ask' ? 'Enter price' : formatCents(b.priceCents)}</span>
                    </span>
                  </button>
                ))}
                {page && page.buttons.length === 0 && <div className="empty-page" style={{ gridColumn: '1 / -1' }}>No buttons on this page yet.</div>}
              </div>
            )}
          </div>

          {!q && (
            <div>
              <div className="sub-label">FREQUENT ITEMS</div>
              <div className="items">
                {frequent.map((i) => (
                  <button key={i.id} className="item" onClick={(e) => { if (e.detail === 0) return; addItem(i); }}>
                    {imageUrl(i.id, i.imageVersion) ? <img className="ph ph-img" src={imageUrl(i.id, i.imageVersion)!} alt="" /> : <div className="ph" style={{ background: i.color }}><CategoryArt category={i.category} name={i.name} size={40} /></div>}
                    <div className="nm">{i.name}{i.size ? ` ${i.size}` : ''}</div>
                    <div className="pr num">{formatCents(i.priceCents)}{i.dealQty && i.dealCents !== null && <span className="deal-tag">{dealLabel(i.dealQty, i.dealCents)}</span>}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="services">
            <button className="svc lotto" onClick={() => setModal({ t: 'lottery' })}><Icon name="ticket" size={28} /><span>Lottery<small>Pick an amount</small></span></button>
            <button className="svc" onClick={() => setModal({ t: 'gas' })}><Icon name="gas" size={28} /><span>Gas<small>Enter the amount</small></span></button>
            <button className="svc" onClick={() => setModal({ t: 'check' })}><Icon name="check" size={28} /><span>Cash a Check<small>{formatCents(boot.settings.checkFeeCents)} fee</small></span></button>
            <button className="svc" onClick={() => { const b = btnByName('Non-listed Item'); if (b) tapButton(b); }}><Icon name="tag" size={28} /><span>Non-listed Item<small>Enter the price</small></span></button>
            <button className="svc" onClick={() => setModal({ t: 'payout' })}><Icon name="payout" size={28} /><span>Lottery Payout<small>Cash paid out</small></span></button>
          </div>

          <div className="actions">
            <button className="act hold" onClick={holdTicket}><Icon name="hold" /> Hold{holds.length > 0 && <span className="badge" data-testid="hold-badge">{holds.length}</span>}</button>
            <button className="act" onClick={openRecall}><Icon name="recall" /> Recall</button>
            <button className="act" onClick={() => noSale()}><Icon name="drawer" /> Open Register</button>
            <button className="act" onClick={() => setModal({ t: 'discount' })}><Icon name="discount" /> Discount</button>
            <button className="act" onClick={() => setModal({ t: 'tabpaypick' })}><Icon name="id" /> Pay on Tab</button>
          </div>

          {kb && (
            <div className="kb-dock" style={{ position: 'absolute', left: 14, right: 14, bottom: 14, zIndex: 5, boxShadow: '0 8px 30px rgba(20,34,46,.35)' }}>
              <OnScreenKeyboard onChar={(c) => setSearch((s) => s + c)} onBack={() => setSearch((s) => s.slice(0, -1))} onClear={() => setSearch('')} onDone={() => setKb(false)} />
            </div>
          )}
        </section>
      </div>

      {modal?.t === 'cash' && <CashModal total={totals.totalCents} busy={busy} error={payError} onClose={() => setModal(null)} onComplete={(t) => completeSale({ tender: 'cash', tenderedCents: t })} />}
      {modal?.t === 'card' && <CardModal total={totals.totalCents} busy={busy} error={payError} onClose={() => setModal(null)} onComplete={() => completeSale({ tender: 'card', reference: '' })} />}
      {modal?.t === 'tabpick' && <CustomerPickModal title="Put on whose tab?" hint="Tap the customer. The whole ticket, tax included, goes on their tab." cashier={user.name} onClose={() => setModal(null)} onPick={(c) => setModal({ t: 'tabcharge', customer: c })} />}
      {modal?.t === 'tabcharge' && <TabChargeModal customer={modal.customer} total={totals.totalCents} busy={busy} error={payError} onClose={() => setModal({ t: 'tabpick' })}
        onConfirm={() => completeSale({ tender: 'tab', customerId: modal.customer.id })} />}
      {modal?.t === 'tabpaypick' && <CustomerPickModal title="Pay on tab" hint="Who is paying on their tab?" cashier={user.name} onClose={() => setModal(null)} onPick={(c) => setModal({ t: 'tabpay', customer: c })} />}
      {modal?.t === 'tabpay' && <TabPaymentModal customer={modal.customer} cashier={user.name} onClose={() => setModal(null)}
        onDone={(bal) => { setModal(null); showToast(`Payment taken. ${modal.customer.name} now owes ${formatCents(bal)}.`); }} />}
      {modal?.t === 'power' && <PowerModal ticketOpen={lines.length > 0} onClose={() => setModal(null)} onPick={power} />}
      {modal?.t === 'gas' && <AskModal title="Gas" onClose={() => setModal(null)} onAdd={(cents) => {
        pushLine({ kind: 'service', service: 'gas', name: 'Gas', qty: 1, unitCents: cents, authorityId: null, category: 'Gas', ageMin: null });
        setModal(null);
      }} />}
      {modal?.t === 'check' && <CheckModal defaultFeeCents={boot.settings.checkFeeCents} ticketTotal={totals.totalCents} busy={busy} error={payError} onClose={() => setModal(null)}
        onDone={(cents, fee) => {
          pushLine({ kind: 'service', service: 'check_fee', name: checkFeeLabel(cents), qty: 1,
            unitCents: fee, baseCents: cents, authorityId: null, category: 'Check Cashing', ageMin: null });
          setModal(null);
          showToast(`Check for ${formatCents(cents)} on the ticket. Press CHECK when done to pay out the cash.`);
        }} />}
      {modal?.t === 'ask' && <AskModal title={modal.button.name} onClose={() => setModal(null)} onAdd={(cents) => {
        const b = modal.button;
        pushLine({ kind: 'ask', name: b.name, qty: 1, unitCents: cents, authorityId: b.authorityId, category: b.category, ageMin: b.ageMin, buttonId: b.id });
        setModal(null);
      }} />}
      {modal?.t === 'lottery' && <LotteryModal onClose={() => setModal(null)} onAdd={(qty, unit) => {
        pushLine({ kind: 'lottery', name: `Lottery ${qty} x $${(unit / 100).toFixed(2)}`, qty, unitCents: unit, authorityId: null, category: 'Lottery', ageMin: null });
        setModal(null);
      }} />}
      {modal?.t === 'payout' && <PayoutModal onClose={() => setModal(null)} onSave={async (cents) => {
        try { await api('/api/lottery-payout', { cashier: user.name, amountCents: cents }); showToast(`Lottery payout of ${formatCents(cents)} recorded.`); setModal(null); }
        catch (e) { showToast((e as Error).message, true); }
      }} />}
      {modal?.t === 'qty' && <QtyModal current={lines.find((l) => l.key === modal.key)?.qty ?? 1} onClose={() => setModal(null)} onSet={(n) => {
        const key = modal.key;
        confirmQty(n, () => { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, qty: n } : l))); setModal(null); });
      }} />}
      {modal?.t === 'pin' && <PinModal title={modal.title} hint={modal.hint} onClose={() => setModal(null)} onOk={(pin) => { const next = modal.then; setModal(null); next(pin); }} />}
      {modal?.t === 'id' && required !== null && <IdModal required={required} info={ageInfo} scanIdOnly={boot.settings.scanIdOnly}
        onClose={() => setModal(null)} onManual={startManual} onManager={startOverride} onRemoveRestricted={removeRestricted} />}
      {modal?.t === 'dob' && <DobModal onClose={() => setModal({ t: 'id' })} onDone={(r) => {
        setAgeInfo({ method: 'manual_dob', ageYears: r.ageYears, expired: r.expired, managerPin: manualPin.current }); setModal({ t: 'id' });
      }} />}
      {modal?.t === 'link' && <LinkModal code={modal.code} items={boot.items} lookup={modal.lookup} error={linkError} onClose={() => setModal(null)} onLink={(id) => linkBarcode(modal.code, id)}
        onNew={() => { if (modal.lookup === undefined) return; setLinkError(''); setModal({ t: 'newitem', code: modal.code, lookup: modal.lookup ?? null }); }} />}
      {modal?.t === 'newitem' && <NewItemModal code={modal.code} lookup={modal.lookup} authorities={boot.authorities} error={linkError} busy={newItemBusy}
        categories={Array.from(new Set(boot.items.map((i) => i.category))).sort()} onClose={() => setModal(null)} onSave={(item) => saveNewItem(modal.code, item)} />}
      {modal?.t === 'recall' && <RecallModal holds={holds} onClose={() => setModal(null)} onRecall={recall} />}
      {modal?.t === 'discount' && <DiscountModal buttons={boot.settings.discountButtons} current={discountPct} onClose={() => setModal(null)} onPick={(p) => { setDiscountPct(p); setModal(null); }} />}
      {modal?.t === 'confirm' && <ConfirmModal title={modal.title} message={modal.message} yes={modal.yes} onYes={modal.onYes} onClose={() => setModal(null)} />}
      {modal?.t === 'receipt' && <ReceiptModal receipt={modal.receipt} onDone={() => { clearTicket(); setModal(null); }} />}
      {modal?.t === 'today' && <TodayModal onClose={() => setModal(null)} />}
      {toast && <div className={`toast ${toast.bad ? 'bad' : ''}`} role="status">{toast.msg}</div>}
    </div>
  );
}

function Login({ store, version, onLogin }: { store: string; version: string; onLogin: (u: User) => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const press = (k: string) => {
    setError('');
    if (k === 'clear') setPin('');
    else if (k === 'back') setPin((p) => p.slice(0, -1));
    else if (k !== '00') setPin((p) => (p + k).slice(0, 8));
  };
  const submit = async () => {
    try { onLogin({ ...(await api<{ name: string; role: string }>('/api/login', { pin })), pin }); }
    catch (e) { setError((e as Error).message); setPin(''); }
  };
  return (
    <div className="login">
      <div className="modal">
        <h2>{store}</h2>
        <div className="hint">Enter your PIN to start. <span style={{ opacity: 0.6 }}>v{version}</span></div>
        <div className="dots" aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => <i key={i} className={i < pin.length ? 'f' : ''} />)}
        </div>
        <Keypad onKey={press} onEnter={() => { if (pin.length >= 4) submit(); }} />
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn btn-primary btn-block" style={{ minHeight: 62, fontSize: 22 }} disabled={pin.length < 4} onClick={submit}>Start</button>
      </div>
    </div>
  );
}
