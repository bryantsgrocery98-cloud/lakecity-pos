// Looks up an unknown barcode in the free, open product databases (Open Food Facts and its
// sister projects). Returns a name, size and picture so a new item can be added in seconds.
// Nothing about the store is sent: only the barcode.

export let lastLookupError: string | null = null;

export type Lookup = {
  found: boolean;
  code: string;
  name: string;
  size: string | null;
  imageUrl: string | null;
  /** A guess at the store category, from the database's tags. */
  category: string | null;
  ageMin: number | null;
  source: string | null;
};

const SOURCES = [
  ['Open Food Facts', 'https://world.openfoodfacts.org'],
  ['Open Products Facts', 'https://world.openproductsfacts.org'],
  ['Open Beauty Facts', 'https://world.openbeautyfacts.org'],
  ['Open Pet Food Facts', 'https://world.openpetfoodfacts.org'],
] as const;

const UA = 'BryantsGroceryPOS/1.0 (store register; open-source POS)';
const cache = new Map<string, { at: number; value: Lookup }>();

type OffProduct = { product_name?: string; product_name_en?: string; brands?: string; quantity?: string; image_front_url?: string; image_url?: string; categories_tags?: string[] };

export function guessCategory(tags: string[]): { category: string | null; ageMin: number | null } {
  const t = tags.join(' ').toLowerCase();
  if (/alcohol|beers|wines|spirits|liquor|hard-seltzer|ciders/.test(t)) return { category: 'Alcohol', ageMin: 21 };
  if (/tobacco|cigarette|cigar|vap|nicotine|snus/.test(t)) return { category: 'Tobacco', ageMin: 21 };
  if (/beverages|drinks|waters|sodas|juices|energy|coffee|teas|milks/.test(t)) return { category: 'Drinks', ageMin: null };
  if (/snacks|chips|crisps|candies|candy|chocolate|confectioner|cookies|biscuits|gum|nuts|crackers|popcorn|jerky/.test(t)) return { category: 'Snack', ageMin: null };
  if (/pet-food|cat-food|dog-food/.test(t)) return { category: 'Household', ageMin: null };
  if (/cleaning|household|hygiene|beauty|cosmetic|paper|detergent|soap|shampoo|batter/.test(t)) return { category: 'Household', ageMin: null };
  if (t.trim()) return { category: 'Food', ageMin: null };
  return { category: null, ageMin: null };
}

/** Builds a clean display name: brand + product name, without repeating the brand. */
export function displayName(p: OffProduct): string {
  const name = (p.product_name_en || p.product_name || '').trim();
  const brand = (p.brands || '').split(',')[0]?.trim() ?? '';
  if (!name) return brand;
  if (!brand || name.toLowerCase().includes(brand.toLowerCase())) return name;
  return `${brand} ${name}`;
}

export function normalizeCode(code: string): string[] {
  const c = code.replace(/\D/g, '');
  const out = new Set<string>([c]);
  if (c.length === 12) out.add('0' + c);          // UPC-A as EAN-13
  if (c.length === 13 && c.startsWith('0')) out.add(c.slice(1));
  if (c.length === 11) { out.add('0' + c); out.add('00' + c); }
  if (c.length === 8) out.add('00000' + c);
  return [...out];
}

/** Bulk-friendly lookup: Open Food Facts only, one request at a time, so a run over the whole price book stays polite. */
export async function lookupBarcodeLight(code: string, fetchFn: typeof fetch = fetch): Promise<Lookup> {
  return lookupBarcode(code, fetchFn, true);
}

export async function lookupBarcode(code: string, fetchFn: typeof fetch = fetch, light = false): Promise<Lookup> {
  const key = code.replace(/\D/g, '');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.value;
  const miss: Lookup = { found: false, code, name: '', size: null, imageUrl: null, category: null, ageMin: null, source: null };
  // All sources at once, so an answer (or a miss) comes back within a few seconds even offline.
  const tryOne = async (label: string, base: string, c: string): Promise<Lookup | null> => {
    try {
      let res = await fetchFn(`${base}/api/v2/product/${encodeURIComponent(c)}?fields=product_name,product_name_en,brands,quantity,image_front_url,image_url,categories_tags`,
        { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(light ? 25000 : 15000) });
      if (res.status === 404) return null;
      if (!res.ok) {
        // Older endpoint as a fallback (some mirrors answer 5xx on v2).
        res = await fetchFn(`${base}/api/v0/product/${encodeURIComponent(c)}.json`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(light ? 25000 : 15000) });
        if (!res.ok) { lastLookupError = `${label} answered ${res.status} for ${c}`; return null; }
      }
      const j = (await res.json()) as { status?: number; product?: OffProduct };
      if (!j.product || (j.status !== undefined && j.status !== 1)) return null;
      const name = displayName(j.product);
      if (!name) return null;
      const g = guessCategory(j.product.categories_tags ?? []);
      return { found: true, code, name: name.slice(0, 80), size: (j.product.quantity || '').trim().slice(0, 40) || null,
        imageUrl: j.product.image_front_url || j.product.image_url || null, category: g.category, ageMin: g.ageMin, source: label };
    } catch (e) { lastLookupError = `${label}: ${(e as Error).name === 'TimeoutError' ? 'timed out' : (e as Error).message}`; return null; }
  };
  if (light) {
    const [label, base] = SOURCES[0];
    for (const c of normalizeCode(code)) {
      const r = await tryOne(label, base, c);
      if (r) { cache.set(key, { at: Date.now(), value: r }); return r; }
    }
  } else {
    const attempts: Promise<Lookup | null>[] = [];
    for (const [label, base] of SOURCES) for (const c of normalizeCode(code)) attempts.push(tryOne(label, base, c));
    const results = await Promise.all(attempts);
    const found = results.find((r) => r && r.found); // sources are in priority order
    if (found) { cache.set(key, { at: Date.now(), value: found }); return found; }
  }
  cache.set(key, { at: Date.now(), value: miss });
  return miss;
}
