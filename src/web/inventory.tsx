import { useEffect, useMemo, useRef, useState } from 'react';
import { centsFromKeypadDigits, formatCents } from '../core/money';
import type { Authority } from '../core/tax';
import { api } from './api';
import { Icon, Keypad, Modal, OnScreenKeyboard } from './parts';
import { CategoryArt } from './art';

export type InventoryItem = {
  id: number; name: string; size: string | null; priceCents: number; costCents: number | null; category: string;
  authorityId: number | null; ageMin: number | null; qtyOnHand: number; active: boolean; frequent: boolean;
  color: string; imageVersion: number; barcodes: string[];
};

const LOW_STOCK = 5;
export const imageUrl = (id: number, v: number) => (v > 0 ? `/images/${id}.jpg?v=${v}` : null);

type Props = { authorities: Authority[]; cashier: string; pin: string; version: string; onClose: () => void; onChanged: () => void; scanRef: React.MutableRefObject<((code: string) => void) | null> };

export function InventoryPage({ authorities, cashier, pin, version, onClose, onChanged, scanRef }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [q, setQ] = useState('');
  const [kb, setKb] = useState(false);
  const [filter, setFilter] = useState<'all' | 'low' | 'nobc' | 'noimg' | 'off'>('all');
  const [cat, setCat] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sel, setSel] = useState<InventoryItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState('');
  const [update, setUpdate] = useState<{ current: string; latest: string | null; state: string; message: string } | null>(null);
  const [importing, setImporting] = useState(false);

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
  };
  const stockValue = items.filter((i) => i.active).reduce((s, i) => s + Math.max(0, i.qtyOnHand) * i.priceCents, 0);

  const afterSave = (it: InventoryItem | null) => { load().then(() => { if (it) setSel(it); onChanged(); }); };

  return (
    <div className="inv">
      <header className="topbar">
        <div><span className="brand">Inventory</span><span className="sub">{items.filter((i) => i.active).length} items · stock at shelf price {formatCents(stockValue)}</span></div>
        <div className="topbar-right">
          <span className="pill" title={update?.message ?? ''}>v{version}{update?.latest && update.latest !== version ? ` · ${update.latest} available` : ''}</span>
          <button className="btn btn-sm" style={{ background: 'transparent', color: '#fff', borderColor: '#3a5266' }} onClick={() => setImporting(true)}><Icon name="upload" size={20} /> Import price book</button>
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
        <button className={`btn btn-sm ${filter === 'low' ? 'btn-dark' : ''}`} onClick={() => setFilter('low')}>Low stock ({counts.low})</button>
        <button className={`btn btn-sm ${filter === 'nobc' ? 'btn-dark' : ''}`} onClick={() => setFilter('nobc')}>No barcode ({counts.nobc})</button>
        <button className={`btn btn-sm ${filter === 'noimg' ? 'btn-dark' : ''}`} onClick={() => setFilter('noimg')}>No picture ({counts.noimg})</button>
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
                <button key={i.id} className={`inv-card ${sel?.id === i.id ? 'sel' : ''} ${i.qtyOnHand <= LOW_STOCK ? 'low' : ''}`} onClick={() => { setSel(i); setAdding(false); }}>
                  <Thumb item={i} size={120} />
                  <div className="inv-card-name">{i.name}{i.size && <span className="hint"> {i.size}</span>}</div>
                  <div className="inv-card-row"><span className="num" style={{ fontWeight: 700, fontSize: 19 }}>{formatCents(i.priceCents)}</span><span className={`stock ${i.qtyOnHand <= 0 ? 'bad' : ''}`}>{i.qtyOnHand} in stock</span></div>
                  <div className="inv-card-tags">{i.ageMin && <span className="age-tag">{i.ageMin}+</span>}{i.barcodes.length === 0 && <span className="tag">no barcode</span>}{!i.active && <span className="tag">hidden</span>}</div>
                </button>
              ))}
              {shown.length === 0 && <div className="hint" style={{ padding: 24 }}>Nothing matches.</div>}
            </div>
          ) : (
            <table className="rep items-table">
              <thead><tr><th></th><th>Item</th><th>Barcodes</th><th>Category</th><th>Tax</th><th className="num">Price</th><th className="num">Cost</th><th className="num">Stock</th></tr></thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} className={`${i.qtyOnHand <= LOW_STOCK ? 'low' : ''} ${sel?.id === i.id ? 'sel' : ''}`} onClick={() => { setSel(i); setAdding(false); }}>
                    <td><Thumb item={i} size={44} /></td>
                    <td><b>{i.name}</b>{i.size && <span className="hint"> {i.size}</span>}{i.ageMin && <span className="age-tag">{i.ageMin}+</span>}</td>
                    <td className="hint">{i.barcodes.join(', ') || '—'}</td>
                    <td>{i.category}</td><td>{authLabel(i.authorityId)}</td>
                    <td className="num">{formatCents(i.priceCents)}</td>
                    <td className="num hint">{i.costCents === null ? '—' : formatCents(i.costCents)}</td>
                    <td className="num">{i.qtyOnHand <= 0 ? <b style={{ color: 'var(--bad)' }}>{i.qtyOnHand}</b> : i.qtyOnHand}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <aside className="inv-edit">
          {adding ? (
            <ItemEditor key="new" item={null} authorities={authorities} cats={cats} pin={pin} cashier={cashier} onDone={(it) => { setAdding(false); afterSave(it); }} onCancel={() => setAdding(false)} />
          ) : sel ? (
            <ItemEditor key={sel.id} item={sel} authorities={authorities} cats={cats} pin={pin} cashier={cashier} onDone={(it) => afterSave(it)} onCancel={() => setSel(null)} />
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

type Draft = { name: string; size: string; priceCents: number; costCents: number | null; category: string; authorityId: number | null; ageMin: number | null; qtyOnHand: number; frequent: boolean; active: boolean };

function ItemEditor({ item, authorities, cats, pin, cashier, onDone, onCancel }: {
  item: InventoryItem | null; authorities: Authority[]; cats: string[]; pin: string; cashier: string; onDone: (it: InventoryItem | null) => void; onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(item ? { name: item.name, size: item.size ?? '', priceCents: item.priceCents, costCents: item.costCents, category: item.category, authorityId: item.authorityId, ageMin: item.ageMin, qtyOnHand: item.qtyOnHand, frequent: item.frequent, active: item.active }
    : { name: '', size: '', priceCents: 0, costCents: null, category: cats[0] ?? 'Snacks', authorityId: authorities[0]?.id ?? null, ageMin: null, qtyOnHand: 0, frequent: false, active: true });
  const [text, setText] = useState<null | 'name' | 'size' | 'category' | 'barcode'>(null);
  const [num, setNum] = useState<null | 'price' | 'cost' | 'stock'>(null);
  const [cam, setCam] = useState(false);
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
        <Field label="In stock" value={String(d.qtyOnHand)} onEdit={() => setNum('stock')} />
      </div>
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

      {text && <TextModal title={text === 'barcode' ? 'Barcode' : text[0]!.toUpperCase() + text.slice(1)} initial={text === 'barcode' ? '' : text === 'category' ? d.category : d[text]} suggestions={text === 'category' ? cats : undefined}
        onClose={() => setText(null)} onOk={(v) => { if (text === 'barcode') addBarcode(v.trim()); else set(text, v.trim()); setText(null); }} />}
      {num && <NumberModal title={num === 'price' ? 'Price' : num === 'cost' ? 'Cost' : 'Count in stock'} money={num !== 'stock'} current={num === 'price' ? d.priceCents : num === 'cost' ? d.costCents ?? 0 : d.qtyOnHand}
        onClose={() => setNum(null)} onOk={(v) => { if (num === 'price') set('priceCents', v); else if (num === 'cost') set('costCents', v); else set('qtyOnHand', v); setNum(null); }} />}
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
