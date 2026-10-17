import { useEffect, useMemo, useRef, useState } from 'react';
import { centsFromKeypadDigits, formatCents } from '../core/money';
import { dealLabel } from '../core/ticket';
import { play } from './sounds';
import type { Authority } from '../core/tax';
import { api } from './api';
import { Icon, Keypad, Modal, OnScreenKeyboard } from './parts';
import { CategoryArt } from './art';

export type InventoryItem = {
  id: number; name: string; size: string | null; priceCents: number; costCents: number | null; category: string; dealQty?: number | null; dealCents?: number | null;
  authorityId: number | null; ageMin: number | null; qtyOnHand: number; active: boolean; frequent: boolean;
  color: string; imageVersion: number; barcodes: string[];
};

const LOW_STOCK = 5;
export const imageUrl = (id: number, v: number) => (v > 0 ? `/images/${id}.jpg?v=${v}` : null);

type Props = { authorities: Authority[]; cashier: string; pin: string; version: string; trackStock?: boolean; onClose: () => void; onChanged: () => void; scanRef: React.MutableRefObject<((code: string) => void) | null> };

export function InventoryPage({ authorities, cashier, pin, version, trackStock = true, onClose, onChanged, scanRef }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [q, setQ] = useState('');
  const [kb, setKb] = useState(false);
  const [filter, setFilter] = useState<'all' | 'low' | 'nobc' | 'noimg' | 'deals' | 'off'>('all');
  const [bulkDeal, setBulkDeal] = useState(false);
  const [cat, setCat] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sel, setSel] = useState<InventoryItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState('');
  const [update, setUpdate] = useState<{ current: string; latest: string | null; state: string; message: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [finding, setFinding] = useState(false);

  const load = () => api<InventoryItem[]>('/api/items').then(setItems).catch((e: Error) => setMsg(e.message));
  useEffect(() => { load(); api<typeof update>('/api/update/status').then(setUpdate).catch(() => {}); }, []);

  // Scanning on this screen selects the item, or offers to link the code to the selected item.
  useEffect(() => {
    scanRef.current = (code) => {
      const hit = items.find((i) => i.barcodes.includes(code));
      if (hit) { setSel(hit); setMsg(''); return; }
      if (sel) {
        api(`/api/items/${sel.id}/barcodes`, { pin, cashier, code }).then(() => { setMsg(`Barcode ${code} linked to ${sel.name}.`); load().then(() => onChanged()); })
          .catch((e: Error) => setMsg(e.message));
      } else setMsg(`Barcode ${code} is not linked to anything. Tap an item, then scan again to link it.`);
    };
    return () => { scanRef.current = null; };
  }, [items, sel, pin, cashier]);

  const cats = useMemo(() => Array.from(new Set(items.map((i) => i.category))).sort(), [items]);
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((i) => {
      if (filter === 'off' ? i.active : !i.active) return false;
      if (filter === 'low' && i.qtyOnHand > LOW_STOCK) return false;
      if (filter === 'nobc' && i.barcodes.length > 0) return false;
      if (filter === 'noimg' && i.imageVersion > 0) return false;
      if (filter === 'deals' && !i.dealQty) return false;
      if (cat && i.category !== cat) return false;
      const hay = `${i.name} ${i.size ?? ''} ${i.category} ${i.barcodes.join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [items, q, filter, cat]);

  const authLabel = (id: number | null) => {
    const a = authorities.find((x) => x.id === id);
    if (!a) return 'No tax';
    return a.rateBp !== null ? `${a.title} ${a.rateBp / 100}%` : `${a.title} ${formatCents(a.flatCents ?? 0)}`;
  };
  const counts = {
    low: items.filter((i) => i.active && i.qtyOnHand <= LOW_STOCK).length,
    nobc: items.filter((i) => i.active && i.barcodes.length === 0).length,
    noimg: items.filter((i) => i.active && i.imageVersion === 0).length,
    deals: items.filter((i) => i.active && !!i.dealQty).length,
  };
  const stockValue = items.filter((i) => i.active).reduce((s, i) => s + Math.max(0, i.qtyOnHand) * i.priceCents, 0);

  const afterSave = (it: InventoryItem | null) => { load().then(() => { if (it) setSel(it); onChanged(); }); };

  return (
    <div className="inv">
      <header className="topbar">
        <div><span className="brand">Inventory</span><span className="sub">{items.filter((i) => i.active).length} items{trackStock ? ` · stock at shelf price ${formatCents(stockValue)}` : ''}</span></div>
        <div className="topbar-right">
          <span className="pill" title={update?.message ?? ''}>v{version}{update?.latest && update.latest !== version ? ` · ${update.latest} available` : ''}</span>
          <button className="btn btn-sm" style={{ background: 'transparent', color: '#fff', borderColor: '#3a5266' }} onClick={() => setImporting(true)}><Icon name="upload" size={20} /> Import price book</button>
          <button className="btn btn-sm" style={{ background: 'transparent', color: '#fff', borderColor: '#3a5266' }} onClick={() => setFinding(true)}><Icon name="image" size={20} /> Find pictures online</button>
          <button className="btn btn-sm" style={{ background: 'transparent', color: '#fff', borderColor: '#3a5266' }} onClick={() => { setAdding(true); setSel(null); }}><Icon name="plus" size={20} /> New item</button>
          <button className="btn btn-sm btn-primary" onClick={onClose}>Back to register</button>
        </div>
      </header>

      <div className="inv-tools">
        <div className="search" style={{ flex: 1 }}>
          <Icon name="search" size={22} />
          <input value={q} onChange={(e) => setQ(e.target.value)} inputMode="none" placeholder="Search name, category, or barcode" aria-label="Search items" />
          {q && <button className="btn btn-quiet btn-sm" onClick={() => setQ('')}>Clear</button>}
        </div>
        <button className="btn btn-sm" onClick={() => setKb(!kb)}><Icon name="keyboard" size={20} /></button>
        <button className={`btn btn-sm ${view === 'grid' ? 'btn-dark' : ''}`} onClick={() => setView('grid')}>Pictures</button>
        <button className={`btn btn-sm ${view === 'list' ? 'btn-dark' : ''}`} onClick={() => setView('list')}>List</button>
      </div>
      {kb && <OnScreenKeyboard onChar={(c) => setQ((s) => s + c)} onBack={() => setQ((s) => s.slice(0, -1))} onClear={() => setQ('')} onDone={() => setKb(false)} />}
      <div className="inv-filters">
        <button className={`btn btn-sm ${filter === 'all' ? 'btn-dark' : ''}`} onClick={() => setFilter('all')}>All</button>
        {trackStock && <button className={`btn btn-sm ${filter === 'low' ? 'btn-dark' : ''}`} onClick={() => setFilter('low')}>Low stock ({counts.low})</button>}
        <button className={`btn btn-sm ${filter === 'nobc' ? 'btn-dark' : ''}`} onClick={() => setFilter('nobc')}>No barcode ({counts.nobc})</button>
        <button className={`btn btn-sm ${filter === 'noimg' ? 'btn-dark' : ''}`} onClick={() => setFilter('noimg')}>No picture ({counts.noimg})</button>
        <button className={`btn btn-sm ${filter === 'deals' ? 'btn-dark' : ''}`} onClick={() => setFilter('deals')}>Deals ({counts.deals})</button>
        <button className="btn btn-sm btn-primary" onClick={() => setBulkDeal(true)}>Set a deal on several items…</button>
        <button className={`btn btn-sm ${filter === 'off' ? 'btn-dark' : ''}`} onClick={() => setFilter('off')}>Hidden</button>
        <span className="inv-sep" />
        <button className={`btn btn-sm ${cat === '' ? 'btn-dark' : ''}`} onClick={() => setCat('')}>Every category</button>
        {cats.map((c) => <button key={c} className={`btn btn-sm ${cat === c ? 'btn-dark' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      {msg && <div className="inv-msg" role="status">{msg}</div>}

      <div className="inv-body">
        <div className="inv-list">
          {view === 'grid' ? (
            <div className="inv-grid">
              {shown.map((i) => (
                <button key={i.id} className={`inv-card ${sel?.id === i.id ? 'sel' : ''} ${trackStock && i.qtyOnHand <= LOW_STOCK ? 'low' : ''}`} onClick={() => { setSel(i); setAdding(false); }}>
                  <Thumb item={i} size={120} />
                  <div className="inv-card-name">{i.name}{i.size && <span className="hint"> {i.size}</span>}</div>
                  <div className="inv-card-row"><span className="num" style={{ fontWeight: 700, fontSize: 19 }}>{formatCents(i.priceCents)}{i.dealQty && i.dealCents !== null && i.dealCents !== undefined && <span className="deal-tag">{dealLabel(i.dealQty, i.dealCents)}</span>}</span>{trackStock && <span className={`stock ${i.qtyOnHand <= 0 ? 'bad' : ''}`}>{i.qtyOnHand} in stock</span>}</div>
                  <div className="inv-card-tags">{i.ageMin && <span className="age-tag">{i.ageMin}+</span>}{i.barcodes.length === 0 && <span className="tag">no barcode</span>}{!i.active && <span className="tag">hidden</span>}</div>
                </button>
              ))}
              {shown.length === 0 && <div className="hint" style={{ padding: 24 }}>Nothing matches.</div>}
            </div>
          ) : (
            <table className="rep items-table">
              <thead><tr><th></th><th>Item</th><th>Barcodes</th><th>Category</th><th>Tax</th><th className="num">Price</th><th className="num">Cost</th>{trackStock && <th className="num">Stock</th>}</tr></thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} className={`${trackStock && i.qtyOnHand <= LOW_STOCK ? 'low' : ''} ${sel?.id === i.id ? 'sel' : ''}`} onClick={() => { setSel(i); setAdding(false); }}>
                    <td><Thumb item={i} size={44} /></td>
                    <td><b>{i.name}</b>{i.size && <span className="hint"> {i.size}</span>}{i.ageMin && <span className="age-tag">{i.ageMin}+</span>}</td>
                    <td className="hint">{i.barcodes.join(', ') || '—'}</td>
                    <td>{i.category}</td><td>{authLabel(i.authorityId)}</td>
                    <td className="num">{formatCents(i.priceCents)}{i.dealQty && i.dealCents !== null && i.dealCents !== undefined && <span className="deal-tag">{dealLabel(i.dealQty, i.dealCents)}</span>}</td>
                    <td className="num hint">{i.costCents === null ? '—' : formatCents(i.costCents)}</td>
                    {trackStock && <td className="num">{i.qtyOnHand <= 0 ? <b style={{ color: 'var(--bad)' }}>{i.qtyOnHand}</b> : i.qtyOnHand}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <aside className="inv-edit">
          {adding ? (
            <ItemEditor key="new" item={null} authorities={authorities} cats={cats} pin={pin} cashier={cashier} trackStock={trackStock} onDone={(it) => { setAdding(false); afterSave(it); }} onCancel={() => setAdding(false)} />
          ) : sel ? (
            <ItemEditor key={sel.id} item={sel} authorities={authorities} cats={cats} pin={pin} cashier={cashier} trackStock={trackStock} onDone={(it) => afterSave(it)} onCancel={() => setSel(null)} />
          ) : (
            <div className="inv-empty">
              <Icon name="box" size={48} />
              <p>Tap an item to see its picture, price, barcodes and stock, or scan an item to jump to it.</p>
              <p className="hint">Scan an unknown barcode while an item is selected to link it. Stock goes down by itself with each sale.</p>
            </div>
          )}
        </aside>
      </div>
      {importing && <ImportModal pin={pin} cashier={cashier} onClose={() => setImporting(false)} onDone={() => { setImporting(false); load().then(() => onChanged()); }} />}
      {bulkDeal && <BulkDealModal items={items.filter((i) => i.active)} pin={pin} cashier={cashier} onClose={() => { setBulkDeal(false); load().then(() => onChanged()); }} />}
      {finding && <FindImagesModal pin={pin} cashier={cashier} missing={items.filter((i) => i.active && i.imageVersion === 0 && i.barcodes.length > 0).length} onClose={() => { setFinding(false); load().then(() => onChanged()); }} onFinished={() => load().then(() => onChanged())} />}
    </div>
  );
}

type Preview = {
  counts: { rows: number; items: number; buttons: number; zeroPrice: number; negativeStock: number; noCost: number; barcodes: number; images: number; byDepartment: Record<string, number> };
  warnings: { name: string; note: string }[]; skipped: { name: string; reason: string }[]; pages: string[]; demoCount: number; existing: number;
  sample: { name: string; size: string | null; priceCents: number; category: string; authority: string | null; qty: number }[];
};

function ImportModal({ pin, cashier, onClose, onDone }: { pin: string; cashier: string; onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ added: number; updated: number; buttons: number; removedDemo: number; barcodes: number; imagesQueued: number } | null>(null);
  const [imgJob, setImgJob] = useState<{ total: number; done: number; ok: number; running: boolean } | null>(null);
  useEffect(() => {
    if (!result || !result.imagesQueued) return;
    const t = window.setInterval(() => api<typeof imgJob>('/api/import/images/status').then((j) => { setImgJob(j); if (j && !j.running) window.clearInterval(t); }).catch(() => {}), 1500);
    return () => window.clearInterval(t);
  }, [result]);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (f: File) => {
    setError(''); setBusy(true); setFileName(f.name);
    try {
      const text = await f.text();
      setCsv(text);
      setPreview(await api<Preview>('/api/import/pricebook/preview', { pin, csv: text }));
    } catch (e) { setError((e as Error).message); setPreview(null); } finally { setBusy(false); }
  };
  const run = async () => {
    if (!csv || !preview) return;
    setBusy(true); setError('');
    try { setResult(await api('/api/import/pricebook', { pin, cashier, csv, replaceDemo: preview.demoCount > 0 })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Import price book" onClose={onClose} wide>
      {result ? (
        <>
          <div className="inv-msg" style={{ margin: 0, background: '#e6f4ea', color: '#0b4a33', fontSize: 18 }}>
            Done. {result.added} products added, {result.updated} updated, {result.buttons} one-click buttons set up, {result.barcodes} barcodes linked{result.removedDemo ? `, ${result.removedDemo} demo products removed` : ''}.
          </div>
          {result.imagesQueued > 0 && <div className="hint">Pictures: {imgJob ? `${imgJob.done} of ${imgJob.total} downloaded${imgJob.running ? '…' : ` (${imgJob.ok} added)`}` : `downloading ${result.imagesQueued} in the background…`}</div>}
          {result.barcodes === 0 && <div className="hint">Products have no barcodes yet. The first time each one is scanned at the register, pick it from the list and it is linked from then on.</div>}
          <button className="btn btn-primary btn-block" style={{ minHeight: 60 }} onClick={onDone}>Back to inventory</button>
        </>
      ) : (
        <>
          <div className="hint">Choose the CSV export from the old register (the file called Pricebook_Download…). Nothing changes until you press Import.</div>
          <div className="quick" style={{ gridTemplateColumns: '1fr auto' }}>
            <div className="field" style={{ minHeight: 52 }}><span className="field-value" style={{ fontWeight: 500 }}>{fileName || 'No file chosen'}</span></div>
            <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>Choose file</button>
          </div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
          {busy && <div className="hint">Reading…</div>}
          {error && <div className="err" role="alert">{error}</div>}
          {preview && (
            <>
              <div className="quick" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
                <Stat label="Products" value={preview.counts.items} />
                <Stat label="With barcode" value={preview.counts.barcodes} warn={preview.counts.barcodes === 0} />
                <Stat label="With photo" value={preview.counts.images} />
                <Stat label="One-click buttons" value={preview.counts.buttons} />
                <Stat label="Priced at $0" value={preview.counts.zeroPrice} warn={preview.counts.zeroPrice > 0} />
                <Stat label="Negative stock" value={preview.counts.negativeStock} warn={preview.counts.negativeStock > 0} />
              </div>
              <div className="editor-label">BY DEPARTMENT</div>
              <div className="chips">{Object.entries(preview.counts.byDepartment).map(([d, n]) => <span key={d} className="chip chip-static">{d}: {n}</span>)}</div>
              {preview.demoCount > 0 && <div className="inv-msg" style={{ margin: 0 }}>The {preview.demoCount} demo products will be removed and replaced by the real ones. Sales already rung stay in the reports.</div>}
              {preview.existing > 0 && <div className="hint">{preview.existing} products from an earlier import will be updated in place; their barcodes and pictures are kept.</div>}
              {preview.skipped.length > 0 && <div className="hint">Skipped: {preview.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}</div>}
              {preview.warnings.length > 0 && (
                <>
                  <div className="editor-label">TO FIX AFTER IMPORT ({preview.warnings.length})</div>
                  <div className="items-scroll" style={{ maxHeight: 180 }}>
                    <table className="rep"><tbody>{preview.warnings.map((w, i) => <tr key={i}><td>{w.name}</td><td className="hint">{w.note}</td></tr>)}</tbody></table>
                  </div>
                </>
              )}
              <div className="hint">Tax: Alcohol and Tobacco at 8%, Snack/Drinks/Food at 1%, Household and Regulars at 8% (Grocery All). VERIFY WITH SC DEPARTMENT OF REVENUE.</div>
              <button className="btn btn-primary btn-block" style={{ minHeight: 62, fontSize: 20 }} disabled={busy} onClick={run}>Import {preview.counts.items} products</button>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="field" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, background: warn ? '#fff6d9' : '#fff' }}>
      <span className="field-label">{label}</span>
      <span className="num" style={{ fontSize: 26, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

export function Thumb({ item, size }: { item: { id: number; name: string; color: string; imageVersion: number; category: string }; size: number }) {
  const url = imageUrl(item.id, item.imageVersion);
  return url
    ? <img className="thumb" src={url} alt="" width={size} height={size} style={{ width: size, height: size }} />
    : <div className="thumb thumb-blank" style={{ width: size, height: size, background: item.color }} aria-hidden="true"><CategoryArt category={item.category} name={item.name} size={Math.round(size * 0.6)} /></div>;
}

// ---------- editor ----------

type Draft = { name: string; size: string; priceCents: number; costCents: number | null; category: string; authorityId: number | null; ageMin: number | null; qtyOnHand: number; frequent: boolean; active: boolean; dealQty: number | null; dealCents: number | null };

function ItemEditor({ item, authorities, cats, pin, cashier, trackStock = true, onDone, onCancel }: {
  item: InventoryItem | null; authorities: Authority[]; cats: string[]; pin: string; cashier: string; trackStock?: boolean; onDone: (it: InventoryItem | null) => void; onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(item ? { name: item.name, size: item.size ?? '', priceCents: item.priceCents, costCents: item.costCents, category: item.category, authorityId: item.authorityId, ageMin: item.ageMin, qtyOnHand: item.qtyOnHand, frequent: item.frequent, active: item.active, dealQty: item.dealQty ?? null, dealCents: item.dealCents ?? null }
    : { name: '', size: '', priceCents: 0, costCents: null, category: cats[0] ?? 'Snacks', authorityId: authorities[0]?.id ?? null, ageMin: null, qtyOnHand: 0, frequent: false, active: true, dealQty: null, dealCents: null });
  const [text, setText] = useState<null | 'name' | 'size' | 'category' | 'barcode'>(null);
  const [num, setNum] = useState<null | 'price' | 'cost' | 'stock' | 'dealQty' | 'dealCents'>(null);
  const [cam, setCam] = useState(false);
  const [quick, setQuick] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [imgV, setImgV] = useState(item?.imageVersion ?? 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setBusy(true); setError('');
    try {
      const body = { ...d, size: d.size || null, pin, cashier };
      const saved = item ? await api<InventoryItem>(`/api/items/${item.id}`, body) : await api<InventoryItem>('/api/items', body);
      onDone(saved);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const uploadImage = async (blob: Blob) => {
    if (!item) { setError('Save the item first, then add its picture.'); return; }
    setBusy(true); setError('');
    try {
      const dataUrl = await shrinkToJpeg(blob, 480);
      const r = await api<{ imageVersion: number }>(`/api/items/${item.id}/image`, { pin, cashier, dataUrl });
      setImgV(r.imageVersion);
      onDone({ ...item, imageVersion: r.imageVersion });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); uploadImage(f); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const removeBarcode = async (code: string) => {
    if (!item) return;
    try { await api(`/api/items/${item.id}/barcodes/${encodeURIComponent(code)}?pin=${pin}&cashier=${encodeURIComponent(cashier)}`, undefined, 'DELETE'); onDone({ ...item, barcodes: item.barcodes.filter((c) => c !== code) }); }
    catch (e) { setError((e as Error).message); }
  };
  const addBarcode = async (code: string) => {
    if (!item) return;
    try { await api(`/api/items/${item.id}/barcodes`, { pin, cashier, code }); onDone({ ...item, barcodes: [...item.barcodes, code] }); }
    catch (e) { setError((e as Error).message); }
  };

  const url = item ? imageUrl(item.id, imgV) : null;

  return (
    <div className="editor">
      <div className="editor-head">
        <h2>{item ? 'Edit item' : 'New item'}</h2>
        <button className="btn btn-quiet btn-sm" onClick={onCancel}>Close</button>
      </div>

      <div className="editor-photo">
        {url ? <img src={url} alt="" /> : <div className="editor-photo-blank"><Icon name="image" size={40} /><span>No picture yet</span></div>}
        <div className="editor-photo-btns">
          <button className="btn btn-sm" disabled={!item} onClick={() => fileRef.current?.click()}>Choose file</button>
          <button className="btn btn-sm" disabled={!item} onClick={() => setCam(true)}>Camera</button>
          {url && <button className="btn btn-sm btn-danger" onClick={async () => { await api(`/api/items/${item!.id}/image?pin=${pin}`, undefined, 'DELETE'); setImgV(0); onDone({ ...item!, imageVersion: 0 }); }}>Remove</button>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ''; }} />
        {!item && <div className="hint">Save the item first, then add a picture. You can also paste a picture from the clipboard.</div>}
      </div>

      <Field label="Name" value={d.name || '—'} onEdit={() => setText('name')} />
      <Field label="Size" value={d.size || '—'} onEdit={() => setText('size')} />
      <div className="editor-row">
        <Field label="Price" value={formatCents(d.priceCents)} onEdit={() => setNum('price')} />
        <Field label="Cost" value={d.costCents === null ? '—' : formatCents(d.costCents)} onEdit={() => setNum('cost')} />
        {trackStock && <Field label="In stock" value={String(d.qtyOnHand)} onEdit={() => setNum('stock')} />}
      </div>
      <div className="editor-label">DEAL (optional) — e.g. 2 for $1.00</div>
      <div className="editor-row">
        <Field label="How many" value={d.dealQty ? String(d.dealQty) : '—'} onEdit={() => setNum('dealQty')} />
        <Field label="For" value={d.dealCents !== null ? formatCents(d.dealCents) : '—'} onEdit={() => setNum('dealCents')} />
        <button className="btn" style={{ alignSelf: 'end', minHeight: 52 }} disabled={d.dealQty === null && d.dealCents === null} onClick={() => { set('dealQty', null); set('dealCents', null); }}>No deal</button>
      </div>
      {d.dealQty && d.dealCents !== null && <div className="hint">Customers pay {formatCents(d.dealCents)} for every {d.dealQty}; extra ones ring at {formatCents(d.priceCents)} each. Works across the whole ticket automatically.</div>}
      <Field label="Category" value={d.category} onEdit={() => setText('category')} />
      <div className="editor-label">TAX OR FEE</div>
      <div className="chips">
        <button className={`chip ${d.authorityId === null ? 'on' : ''}`} onClick={() => set('authorityId', null)}>No tax</button>
        {authorities.map((a) => <button key={a.id} className={`chip ${d.authorityId === a.id ? 'on' : ''}`} onClick={() => set('authorityId', a.id)}>{a.title} {a.rateBp !== null ? `${a.rateBp / 100}%` : formatCents(a.flatCents ?? 0)}</button>)}
      </div>
      <div className="editor-label">ID CHECK</div>
      <div className="chips">
        <button className={`chip ${d.ageMin === null ? 'on' : ''}`} onClick={() => set('ageMin', null)}>Not needed</button>
        <button className={`chip ${d.ageMin === 18 ? 'on' : ''}`} onClick={() => set('ageMin', 18)}>18+</button>
        <button className={`chip ${d.ageMin === 21 ? 'on' : ''}`} onClick={() => set('ageMin', 21)}>21+</button>
      </div>
      <div className="chips">
        <button className={`chip ${d.frequent ? 'on' : ''}`} onClick={() => set('frequent', !d.frequent)}>Show in Frequent Items</button>
        <button className={`chip ${!d.active ? 'on' : ''}`} onClick={() => set('active', !d.active)}>Hidden from register</button>
      </div>

      {item && (
        <>
          <div className="editor-label">BARCODES</div>
          <div className="chips">
            {item.barcodes.map((c) => <span key={c} className="chip chip-static">{c} <button aria-label={`Remove ${c}`} className="chip-x" onClick={() => removeBarcode(c)}>×</button></span>)}
            <button className="chip" onClick={() => setText('barcode')}>+ Type one</button>
          </div>
          <div className="hint">Or just scan the product now to link its barcode.</div>
        </>
      )}

      {error && <div className="err" role="alert">{error}</div>}
      <button className="btn btn-primary btn-block" style={{ minHeight: 60, fontSize: 20 }} disabled={busy} onClick={save}>{item ? 'Save changes' : 'Create item'}</button>
      {item && <button className="btn btn-block" style={{ minHeight: 52 }} onClick={() => setQuick(true)}><Icon name="plus" size={18} /> Add to a quick page (one-tap button on the register)</button>}
      {quick && item && <QuickButtonModal item={item} pin={pin} cashier={cashier} onClose={() => setQuick(false)} />}

      {text && <TextModal title={text === 'barcode' ? 'Barcode' : text[0]!.toUpperCase() + text.slice(1)} initial={text === 'barcode' ? '' : text === 'category' ? d.category : d[text]} suggestions={text === 'category' ? cats : undefined}
        onClose={() => setText(null)} onOk={(v) => { if (text === 'barcode') addBarcode(v.trim()); else set(text, v.trim()); setText(null); }} />}
      {num && <NumberModal title={num === 'price' ? 'Price' : num === 'cost' ? 'Cost' : num === 'stock' ? 'Count in stock' : num === 'dealQty' ? 'Deal: how many' : 'Deal: price for the group'}
        money={num === 'price' || num === 'cost' || num === 'dealCents'}
        current={num === 'price' ? d.priceCents : num === 'cost' ? d.costCents ?? 0 : num === 'stock' ? d.qtyOnHand : num === 'dealQty' ? d.dealQty ?? 2 : d.dealCents ?? 0}
        onClose={() => setNum(null)} onOk={(v) => {
          if (num === 'price') set('priceCents', v); else if (num === 'cost') set('costCents', v); else if (num === 'stock') set('qtyOnHand', v);
          else if (num === 'dealQty') set('dealQty', v >= 2 ? v : null); else set('dealCents', v);
          setNum(null);
        }} />}
      {cam && <CameraModal onClose={() => setCam(false)} onShot={(b) => { setCam(false); uploadImage(b); }} />}
    </div>
  );
}

function Field({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <button className="field" onClick={onEdit}>
      <span className="field-label">{label}</span>
      <span className="field-value">{value}</span>
      <Icon name="edit" size={18} />
    </button>
  );
}

function TextModal({ title, initial, suggestions, onClose, onOk }: { title: string; initial: string; suggestions?: string[]; onClose: () => void; onOk: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="display plain" style={{ fontSize: 26, justifyContent: 'flex-start' }}>{v || <span className="hint">Type below</span>}</div>
      {suggestions && <div className="chips">{suggestions.map((s) => <button key={s} className={`chip ${v === s ? 'on' : ''}`} onClick={() => setV(s)}>{s}</button>)}</div>}
      <OnScreenKeyboard onChar={(c) => setV((s) => s + c)} onBack={() => setV((s) => s.slice(0, -1))} onClear={() => setV('')} onDone={() => onOk(v)} />
      <button className="btn btn-primary btn-block" onClick={() => onOk(v)}>OK</button>
    </Modal>
  );
}

function NumberModal({ title, money, current, onClose, onOk }: { title: string; money: boolean; current: number; onClose: () => void; onOk: (v: number) => void }) {
  const [digits, setDigits] = useState('');
  const press = (k: string) => {
    if (k === 'clear') setDigits('');
    else if (k === 'back') setDigits((s) => s.slice(0, -1));
    else setDigits((s) => (s + k).replace(/^0+(?=\d)/, '').slice(0, 7));
  };
  const value = money ? centsFromKeypadDigits(digits) : parseInt(digits || '0', 10);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="hint">Now: <b>{money ? formatCents(current) : current}</b></div>
      <div className="display num">{digits ? (money ? formatCents(value) : value) : (money ? '$0.00' : '0')}</div>
      <Keypad onKey={press} />
      {!money && <div className="quick">
        <button className="btn btn-sm" onClick={() => setDigits(String(current + 1))}>+1</button>
        <button className="btn btn-sm" onClick={() => setDigits(String(current + 12))}>+12</button>
        <button className="btn btn-sm" onClick={() => setDigits(String(current + 24))}>+24</button>
        <button className="btn btn-sm" onClick={() => setDigits('0')}>Set to 0</button>
      </div>}
      <button className="btn btn-primary btn-block" disabled={!digits} onClick={() => onOk(value)}>OK</button>
    </Modal>
  );
}

function CameraModal({ onClose, onShot }: { onClose: () => void; onShot: (b: Blob) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment', width: 960 } })
      .then((s) => { stream = s; if (videoRef.current) videoRef.current.srcObject = s; })
      .catch(() => setError('The camera could not be opened. Check that the browser is allowed to use it.'));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);
  const snap = () => {
    const v = videoRef.current; if (!v) return;
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    c.toBlob((b) => { if (b) onShot(b); }, 'image/jpeg', 0.9);
  };
  return (
    <Modal title="Take a picture" onClose={onClose}>
      {error ? <div className="err">{error}</div> : <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', borderRadius: 12, background: '#000' }} />}
      <button className="btn btn-primary btn-block" style={{ minHeight: 60 }} disabled={!!error} onClick={snap}>Snap</button>
    </Modal>
  );
}

async function shrinkToJpeg(blob: Blob, max: number): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

type FindJob = { total: number; done: number; found: number; running: boolean; startedAt: string | null; finishedAt: string | null; lastError?: string | null };

function FindImagesModal({ pin, cashier, missing, onClose, onFinished }: { pin: string; cashier: string; missing: number; onClose: () => void; onFinished: () => void }) {
  const [job, setJob] = useState<FindJob | null>(null);
  const [msg, setMsg] = useState('');
  const wasRunning = useRef(false);
  useEffect(() => {
    const tick = () => api<FindJob>('/api/find-images/status').then((j) => {
      setJob(j);
      if (wasRunning.current && !j.running) onFinished(); // refresh the list the moment it finishes
      wasRunning.current = j.running;
    }).catch(() => {});
    tick();
    const t = window.setInterval(tick, 1500);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const start = async () => {
    setMsg('');
    try { setJob(await api<FindJob>('/api/find-images', { pin, cashier })); } catch (e) { setMsg((e as Error).message); }
  };
  const pct = job && job.total ? Math.round((job.done / job.total) * 100) : 0;
  return (
    <Modal title="Find pictures online" onClose={onClose}>
      <div className="hint">Looks up every item that has a barcode but no picture in the free Open Food Facts database and saves the picture it finds. Drinks, snacks and packaged food are usually found; tobacco and local items usually are not. Items that already have a picture are left alone.</div>
      <div className="field"><span className="field-label">Items without a picture</span><span className="field-value" style={{ fontWeight: 700 }}>{missing}</span></div>
      {job && (job.running || job.finishedAt) && (
        <>
          <div className="field"><span className="field-label">{job.running ? 'Searching…' : 'Finished'}</span><span className="field-value">{job.done} of {job.total} checked · {job.found} pictures found</span></div>
          <div style={{ height: 14, borderRadius: 7, background: 'var(--line)', overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width .4s' }} /></div>
          {job.lastError && job.found === 0 && job.done > 3 && <div className="err">The product database is not answering: {job.lastError}. Check the internet connection on this computer, then try again.</div>}
        </>
      )}
      {msg && <div className="err">{msg}</div>}
      <button className="btn btn-primary btn-block" style={{ minHeight: 60 }} disabled={!!job?.running || missing === 0} onClick={start}>{job?.running ? 'Working in the background…' : 'Start'}</button>
      <div className="hint">You can close this and keep using the register; it carries on by itself. Takes a few minutes for a full price book.</div>
      <button className="btn btn-block" onClick={onClose}>Close</button>
    </Modal>
  );
}

/** Pick several items (search + tick) and give them all the same deal, e.g. every Gurley's bag 2 for $2.00. */
function BulkDealModal({ items, pin, cashier, onClose }: { items: InventoryItem[]; pin: string; cashier: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [kb, setKb] = useState(true);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [dealQty, setDealQty] = useState(2);
  const [dealCents, setDealCents] = useState(0);
  const [num, setNum] = useState<null | 'qty' | 'price'>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length === 0 ? [] : items.filter((i) => words.every((w) => `${i.name} ${i.size ?? ''}`.toLowerCase().includes(w))).slice(0, 40);
  const toggle = (id: number) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = () => setPicked(new Set(matches.map((m) => m.id)));
  const apply = async (clear = false) => {
    setBusy(true); setMsg('');
    let ok = 0;
    for (const id of picked) {
      try { await api(`/api/items/${id}`, { pin, cashier, dealQty: clear ? null : dealQty, dealCents: clear ? null : dealCents, reason: 'deal' }); ok++; } catch { /* keep going */ }
    }
    setBusy(false); play('done');
    setMsg(clear ? `Deal removed from ${ok} items.` : `${dealLabel(dealQty, dealCents)} set on ${ok} items.`);
    setPicked(new Set());
  };
  const ready = picked.size > 0 && dealQty >= 2 && dealCents > 0;
  return (
    <Modal title="Set a deal on several items" onClose={onClose} wide footer={<>
      {msg && <div className="inv-msg" style={{ margin: 0 }}>{msg}</div>}
      <div className="quick" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <button className="btn btn-primary" style={{ minHeight: 54 }} disabled={!ready || busy} onClick={() => apply(false)}>{busy ? 'Saving…' : `Set ${dealLabel(dealQty, dealCents)} on ${picked.size} item${picked.size === 1 ? '' : 's'}`}</button>
        <button className="btn btn-danger" style={{ minHeight: 54 }} disabled={picked.size === 0 || busy} onClick={() => apply(true)}>Remove deal from {picked.size}</button>
      </div>
    </>}>
      <div className="editor-label">1 · THE DEAL</div>
      <div className="editor-row">
        <Field label="How many" value={String(dealQty)} onEdit={() => setNum('qty')} />
        <Field label="For" value={formatCents(dealCents)} onEdit={() => setNum('price')} />
      </div>
      <div className="editor-label">2 · FIND THE ITEMS (type part of the name, e.g. gurley)</div>
      <div className="quick" style={{ gridTemplateColumns: '1fr auto auto' }}>
        <div className="display plain" style={{ height: 48, fontSize: 20, justifyContent: 'flex-start', fontWeight: 500 }}>{q || <span style={{ color: 'var(--ink-3)' }}>Search…</span>}</div>
        <button className="btn" onClick={() => setKb(!kb)}><Icon name="keyboard" size={20} /></button>
        <button className="btn" disabled={matches.length === 0} onClick={all}>Tick all {matches.length}</button>
      </div>
      {kb && <OnScreenKeyboard onChar={(c) => setQ((s) => s + c)} onBack={() => setQ((s) => s.slice(0, -1))} onClear={() => setQ('')} onDone={() => setKb(false)} />}
      <div className="chips">
        {matches.map((m) => (
          <button key={m.id} className={`chip ${picked.has(m.id) ? 'on' : ''}`} onClick={() => toggle(m.id)}>
            {picked.has(m.id) ? '✓ ' : ''}{m.name}{m.size ? ` ${m.size}` : ''} · {formatCents(m.priceCents)}{m.dealQty && m.dealCents != null ? ` · ${dealLabel(m.dealQty, m.dealCents)}` : ''}
          </button>
        ))}
        {words.length > 0 && matches.length === 0 && <span className="hint">No items match.</span>}
      </div>
      {picked.size > 0 && <div className="hint">{picked.size} ticked. Tick more by searching again; ticks are kept.</div>}
      {num && <NumberModal title={num === 'qty' ? 'Deal: how many' : 'Deal: price for the group'} money={num === 'price'} current={num === 'qty' ? dealQty : dealCents}
        onClose={() => setNum(null)} onOk={(v) => { if (num === 'qty') setDealQty(Math.max(2, v)); else setDealCents(v); setNum(null); }} />}
    </Modal>
  );
}

/** Puts an item on one of the register's quick pages as a one-tap button. */
function QuickButtonModal({ item, pin, cashier, onClose }: { item: InventoryItem; pin: string; cashier: string; onClose: () => void }) {
  const [pages, setPages] = useState<{ id: number; name: string }[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [pageId, setPageId] = useState<number | null>(null);
  const [fill, setFill] = useState('#FFE0B2');
  const [name, setName] = useState(item.size ? `${item.name} ${item.size}` : item.name);
  const [kb, setKb] = useState(false);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(false);
  useEffect(() => {
    api<{ id: number; name: string }[]>('/api/pages').then((p) => { setPages(p); setPageId(p[0]?.id ?? null); }).catch((e: Error) => setMsg(e.message));
    api<string[]>('/api/button-colors').then((c) => { setColors(c); if (c[0]) setFill(c[0]); }).catch(() => {});
  }, []);
  const add = async () => {
    if (pageId === null) return;
    try { await api('/api/buttons', { pin, cashier, pageId, itemId: item.id, name, fill }); play('done'); setDone(true); setMsg(`Added to ${pages.find((p) => p.id === pageId)?.name}. It shows up on the register right away.`); }
    catch (e) { setMsg((e as Error).message); play('bad'); }
  };
  return (
    <Modal title="Add to a quick page" onClose={onClose} footer={<>
      {msg && <div className="inv-msg" style={{ margin: 0 }}>{msg}</div>}
      {done ? <button className="btn btn-primary btn-block" style={{ minHeight: 54 }} onClick={onClose}>Done</button>
        : <button className="btn btn-primary btn-block" style={{ minHeight: 54 }} disabled={pageId === null || !name.trim()} onClick={add}>Add button</button>}
    </>}>
      <div className="field-label">PAGE</div>
      <div className="chips">{pages.map((p) => <button key={p.id} className={`chip ${pageId === p.id ? 'on' : ''}`} onClick={() => setPageId(p.id)}>{p.name}</button>)}</div>
      <div className="hint">New pages are made on the register: Edit buttons → tap the page name → Add a new page.</div>
      <div className="field-label">NAME ON THE BUTTON</div>
      <div className="quick" style={{ gridTemplateColumns: '1fr auto' }}>
        <div className="display plain" style={{ height: 48, fontSize: 20, justifyContent: 'flex-start', fontWeight: 600 }}>{name}</div>
        <button className="btn" onClick={() => setKb(!kb)}><Icon name="keyboard" size={20} /></button>
      </div>
      {kb && <OnScreenKeyboard onChar={(c) => setName((s) => s + c)} onBack={() => setName((s) => s.slice(0, -1))} onClear={() => setName('')} onDone={() => setKb(false)} />}
      <div className="field-label">COLOR</div>
      <div className="swatches">{colors.map((c) => <button key={c} className={`swatch ${fill === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setFill(c)} aria-label={c} />)}</div>
      <div className="hint">The button uses this item's price, picture, tax and deal, so changing the item later changes the button too.</div>
    </Modal>
  );
}
