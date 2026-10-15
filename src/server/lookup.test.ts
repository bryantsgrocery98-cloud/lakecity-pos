import { describe, expect, it } from 'vitest';
import { displayName, guessCategory, lookupBarcode, normalizeCode } from './lookup.js';

describe('barcode lookup', () => {
  it('normalizes UPC-A / EAN-13 forms', () => {
    expect(normalizeCode('049000050103')).toEqual(['049000050103', '0049000050103']);
    expect(normalizeCode('0049000050103')).toContain('049000050103');
  });
  it('builds a clean name and guesses the category', () => {
    expect(displayName({ product_name: 'Coca-Cola Classic', brands: 'Coca-Cola' })).toBe('Coca-Cola Classic');
    expect(displayName({ product_name: 'Classic', brands: 'Coca-Cola, The Coca-Cola Company' })).toBe('Coca-Cola Classic');
    expect(guessCategory(['en:beverages', 'en:sodas'])).toEqual({ category: 'Drinks', ageMin: null });
    expect(guessCategory(['en:alcoholic-beverages', 'en:beers'])).toEqual({ category: 'Alcohol', ageMin: 21 });
    expect(guessCategory([])).toEqual({ category: null, ageMin: null });
  });
  it('returns the product from the first source that knows it, and a miss otherwise', async () => {
    const fake = (async (url: string) => {
      if (url.includes('openfoodfacts') && url.includes('/0049000050103')) {
        return new Response(JSON.stringify({ status: 1, product: { product_name: 'Classic', brands: 'Coca-Cola', quantity: '20 fl oz', image_front_url: 'https://img/x.jpg', categories_tags: ['en:beverages'] } }), { status: 200 });
      }
      return new Response('{"status":0}', { status: 404 });
    }) as unknown as typeof fetch;
    const r = await lookupBarcode('049000050103', fake);
    expect(r.found).toBe(true);
    expect(r.name).toBe('Coca-Cola Classic');
    expect(r.size).toBe('20 fl oz');
    expect(r.category).toBe('Drinks');
    const miss = await lookupBarcode('999999999999', fake);
    expect(miss.found).toBe(false);
  });
});
