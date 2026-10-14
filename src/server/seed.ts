// Demo data so the app is usable right away.
// Prices, stock and barcodes are MADE UP for the demo. Barcodes start with 99 so
// they cannot be confused with real UPCs. Rates are copied from the store's
// current settings and NEED VERIFICATION with the SC Department of Revenue.

import type { DB } from './db.js';

const AUTH = [
  ['Alcohol', 'tax', 800],
  ['Food and Drink', 'tax', 100],
  ['Grocery All', 'tax', 800],
  ['Motor oils', 'tax', 800],
  ['Tobacco', 'tax', 800],
] as const;

// name, size, price cents, category, authority title, ageMin, color, frequent
type Seed = [string, string, number, string, string | null, number | null, string, number];

const ITEMS: Seed[] = [
  ['Cola', '20 oz', 229, 'Drinks', 'Food and Drink', null, '#7C3A2D', 1],
  ['Lemon-Lime Soda', '20 oz', 229, 'Drinks', 'Food and Drink', null, '#4C8B3F', 1],
  ['Orange Soda', '20 oz', 229, 'Drinks', 'Food and Drink', null, '#C46A1B', 0],
  ['Root Beer', '20 oz', 229, 'Drinks', 'Food and Drink', null, '#6B4A3A', 0],
  ['Water', '16 oz', 129, 'Drinks', 'Food and Drink', null, '#3C7DB5', 1],
  ['Sparkling Water', '12 oz', 149, 'Drinks', 'Food and Drink', null, '#5A9BC4', 0],
  ['Sports Drink', '20 oz', 249, 'Drinks', 'Food and Drink', null, '#2E8F7A', 0],
  ['Energy Drink', '16 oz', 299, 'Drinks', 'Food and Drink', null, '#2F5C8A', 0],
  ['Iced Tea', '20 oz', 199, 'Drinks', 'Food and Drink', null, '#A8741A', 0],
  ['Apple Juice', '12 oz', 199, 'Drinks', 'Food and Drink', null, '#B58A2D', 0],
  ['Orange Juice', '12 oz', 229, 'Drinks', 'Food and Drink', null, '#D9822B', 0],
  ['Whole Milk', 'pint', 189, 'Drinks', 'Food and Drink', null, '#8FA3B3', 0],
  ['Coffee', '12 oz cup', 179, 'Drinks', 'Food and Drink', null, '#5A3B22', 0],
  ['Nacho Chips', '3 oz', 279, 'Snacks', 'Food and Drink', null, '#B5651D', 1],
  ['Potato Chips', '3 oz', 279, 'Snacks', 'Food and Drink', null, '#C99A2E', 0],
  ['Pretzels', '3 oz', 199, 'Snacks', 'Food and Drink', null, '#8A6A2F', 1],
  ['Cheese Crackers', '6 pack', 149, 'Snacks', 'Food and Drink', null, '#D9A441', 0],
  ['Peanut Butter Crackers', '6 pack', 149, 'Snacks', 'Food and Drink', null, '#B8832F', 0],
  ['Popcorn', '3 oz', 249, 'Snacks', 'Food and Drink', null, '#E0C46A', 0],
  ['Beef Jerky', '2.5 oz', 499, 'Snacks', 'Food and Drink', null, '#7A3B3B', 0],
  ['Trail Mix', '3 oz', 299, 'Snacks', 'Food and Drink', null, '#8A5A2B', 0],
  ['Sunflower Seeds', '5 oz', 229, 'Snacks', 'Food and Drink', null, '#6B7A3A', 0],
  ['Honey Bun', 'each', 169, 'Snacks', 'Food and Drink', null, '#C98A3A', 0],
  ['Moon Pie', 'each', 129, 'Snacks', 'Food and Drink', null, '#7B4A2E', 0],
  ['Granola Bar', 'each', 149, 'Snacks', 'Food and Drink', null, '#8F7A3A', 0],
  ['Frozen Burrito', 'each', 249, 'Frozen', 'Food and Drink', null, '#B5651D', 0],
  ['Frozen Pizza Slice', 'each', 299, 'Frozen', 'Food and Drink', null, '#B8452B', 0],
  ['Ice Cream Sandwich', 'each', 199, 'Frozen', 'Food and Drink', null, '#6B6B7A', 0],
  ['Ice Pop', 'each', 99, 'Frozen', 'Food and Drink', null, '#C94A7A', 0],
  ['Chocolate Bar', 'each', 149, 'Candy', 'Food and Drink', null, '#6B4A3A', 1],
  ['Peanut Candy Bar', 'each', 149, 'Candy', 'Food and Drink', null, '#8A5A2B', 0],
  ['Gummy Bears', '4 oz', 199, 'Candy', 'Food and Drink', null, '#C94A4A', 0],
  ['Sour Worms', '4 oz', 199, 'Candy', 'Food and Drink', null, '#4A9B4A', 0],
  ['Mint Gum', 'pack', 179, 'Candy', 'Food and Drink', null, '#2E8F7A', 1],
  ['Fruit Gum', 'pack', 179, 'Candy', 'Food and Drink', null, '#C94A7A', 0],
  ['Breath Mints', 'tin', 199, 'Candy', 'Food and Drink', null, '#4A8FB5', 0],
  ['Hard Candy', 'bag', 249, 'Candy', 'Food and Drink', null, '#B5651D', 0],
  ['Lollipop', 'each', 49, 'Candy', 'Food and Drink', null, '#C94A7A', 0],
  ['Cigarettes', 'pack', 949, 'Tobacco', 'Tobacco', 21, '#4A4A4A', 1],
  ['Cigarettes Menthol', 'pack', 979, 'Tobacco', 'Tobacco', 21, '#2E6B6B', 1],
  ['Cigarettes Value', 'pack', 849, 'Tobacco', 'Tobacco', 21, '#6B4A3A', 0],
  ['Cigars', '2 pack', 199, 'Tobacco', 'Tobacco', 21, '#5A3B22', 0],
  ['Chewing Tobacco', 'pouch', 449, 'Tobacco', 'Tobacco', 21, '#3B4A2E', 0],
  ['Rolling Papers', 'pack', 199, 'Tobacco', 'Tobacco', 21, '#8F8F8F', 0],
  ['Lighter', 'each', 199, 'Tobacco', 'Grocery All', null, '#B8452B', 0],
  ['Lager', '12 oz can', 199, 'Beer', 'Alcohol', 21, '#D9B93A', 0],
  ['Light Lager', '12 oz can', 199, 'Beer', 'Alcohol', 21, '#E0C46A', 0],
  ['Lager', '24 oz can', 249, 'Beer', 'Alcohol', 21, '#C9A22E', 0],
  ['Malt Liquor', '40 oz', 349, 'Beer', 'Alcohol', 21, '#7A8F3A', 0],
  ['Hard Seltzer', '12 oz can', 229, 'Beer', 'Alcohol', 21, '#C94A7A', 0],
  ['Table Wine', '750 ml', 899, 'Wine', 'Alcohol', 21, '#7A2E4A', 0],
  ['Paper Towels', 'roll', 199, 'Household', 'Grocery All', null, '#5B6B78', 0],
  ['Bath Tissue', '4 pack', 349, 'Household', 'Grocery All', null, '#7A8FA3', 0],
  ['Dish Soap', '12 oz', 299, 'Household', 'Grocery All', null, '#3C9BC4', 0],
  ['Trash Bags', '10 count', 399, 'Household', 'Grocery All', null, '#3B3B3B', 0],
  ['Batteries AA', '4 pack', 699, 'Household', 'Grocery All', null, '#C99A2E', 0],
  ['Pain Reliever', '24 ct', 599, 'Household', 'Grocery All', null, '#B83A3A', 0],
  ['Motor Oil', 'quart', 549, 'Auto', 'Motor oils', null, '#3B3B3B', 0],
  ['Windshield Washer', 'gallon', 399, 'Auto', 'Motor oils', null, '#3C7DB5', 0],
  ['Newspaper', 'each', 200, 'Regulars', 'Grocery All', null, '#7A7A7A', 0],
  ['Cat Food', 'can', 129, 'Regulars', 'Grocery All', null, '#A8741A', 0],
];

type Btn = [string, number, string, string, string, string, string | null, number | null, string, string, string];
// name, price, mode, shape, fill, border, authority title, ageMin, category, text, page
const BUTTONS: Btn[] = [
  ['6 Pack', 999, 'fixed', 'six', '#FFE9CC', '#E0A458', 'Alcohol', 21, 'Beer', '#5A3200', 'ICE COLD BEER'],
  ['1 CAN', 199, 'fixed', 'can', '#DCEBFF', '#7FAEEA', 'Alcohol', 21, 'Beer', '#0F2F66', 'ICE COLD BEER'],
  ['12 Pack', 1699, 'fixed', 'twelve', '#FFE0D6', '#E58B6D', 'Alcohol', 21, 'Beer', '#6B2410', 'ICE COLD BEER'],
  ['18 Pack', 2299, 'fixed', 'eighteen', '#F3DDFB', '#C58BE0', 'Alcohol', 21, 'Beer', '#4A1A63', 'ICE COLD BEER'],
  ['Ice Bag', 249, 'fixed', 'bag', '#DDF1FA', '#6CB9DB', 'Grocery All', null, 'Regulars', '#0B3F57', 'ICE COLD BEER'],
  ['ICE CUP', 50, 'fixed', 'cup', '#DDF1FA', '#6CB9DB', 'Grocery All', null, 'Regulars', '#0B3F57', 'ICE COLD BEER'],
  ['Ice Scoop', 100, 'fixed', 'box', '#E4E7EA', '#9AA6B0', 'Grocery All', null, 'Regulars', '#26323C', 'ICE COLD BEER'],
  ['Natural Light 15 Pack', 1399, 'fixed', 'eighteen', '#FFF1B8', '#D9B93A', 'Alcohol', 21, 'Beer', '#4F3F00', 'ICE COLD BEER'],
  ['Michelob Ultra 6 pack', 949, 'fixed', 'six', '#D9F3E6', '#5DB68A', 'Alcohol', 21, 'Beer', '#0B4A33', 'ICE COLD BEER'],
  ['RED SOLO CUP', 25, 'fixed', 'cup', '#FFD9D6', '#E0625A', 'Grocery All', null, 'Regulars', '#6B1410', 'ICE COLD BEER'],
  ['Check Cashing Fee', 0, 'ask', 'box', '#EAF0F5', '#8DA2B3', null, null, 'Services', '#14222E', 'Checks & Services'],
  ['Non-listed Item', 0, 'ask', 'box', '#EAF0F5', '#8DA2B3', 'Grocery All', null, 'Misc', '#14222E', 'Checks & Services'],
  ['Dumdum', 25, 'fixed', 'bag', '#FFD9D6', '#E0625A', 'Food and Drink', null, 'Candy', '#6B1410', 'No Code Items'],
  ['Fruit Roll Up', 99, 'fixed', 'box', '#F3DDFB', '#C58BE0', 'Food and Drink', null, 'Candy', '#4A1A63', 'No Code Items'],
  ['Now and Later', 50, 'fixed', 'box', '#FFF1B8', '#D9B93A', 'Food and Drink', null, 'Candy', '#4F3F00', 'No Code Items'],
  ['Tootsie Pop', 25, 'fixed', 'bag', '#FFE0D6', '#E58B6D', 'Food and Drink', null, 'Candy', '#6B2410', 'No Code Items'],
  ['Tylenol Extra Strength', 199, 'fixed', 'box', '#DCEBFF', '#7FAEEA', 'Grocery All', null, 'Household', '#0F2F66', 'No Code Items'],
  ['Boiled Peanuts', 200, 'fixed', 'cup', '#D9F3E6', '#5DB68A', 'Food and Drink', null, 'Snacks', '#0B4A33', 'No Code Items'],
  ['Wax Worm', 300, 'fixed', 'cup', '#E4E7EA', '#9AA6B0', 'Grocery All', null, 'Misc', '#26323C', 'No Code Items'],
];

export function seedIfEmpty(db: DB): boolean {
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM items`).get() as { n: number }).n;
  if (n > 0) return false;

  const tx = db.transaction(() => {
    const set = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
    set.run('store_name', 'BRYANTS GROCERY');
    set.run('store_address', '1928 New Zion Rd, Lake City, SC 29560');
    set.run('store_phone', '');
    set.run('timezone', 'America/New_York');
    set.run('workday_start', '00:00');
    set.run('discount_buttons', '5,10,15,20');
    set.run('warn_qty', '99');
    set.run('warn_total_cents', '99999');
    set.run('scan_id_only', 'true');
    set.run('receipt_footer', 'Thank you! Please come again.');
    set.run('refund_policy', 'See store for refund policy.');

    // Demo PINs. Change these in Settings before real use.
    const user = db.prepare(`INSERT INTO users (name, pin, role) VALUES (?, ?, ?)`);
    user.run('Dee', '1111', 'cashier');
    user.run('Manager', '2222', 'manager');
    user.run('Owner', '3333', 'owner');

    const auth = db.prepare(`INSERT INTO authorities (title, type, rate_bp, flat_cents) VALUES (?, ?, ?, NULL)`);
    for (const [t, ty, bp] of AUTH) auth.run(t, ty, bp);
    const authId = (title: string | null): number | null =>
      title === null ? null : (db.prepare(`SELECT id FROM authorities WHERE title = ?`).get(title) as { id: number }).id;

    const item = db.prepare(`INSERT INTO items (name, size, price_cents, category, authority_id, age_min, color, frequent, qty_on_hand)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const bc = db.prepare(`INSERT INTO barcodes (code, item_id) VALUES (?, ?)`);
    ITEMS.forEach((s, i) => {
      const r = item.run(s[0], s[1], s[2], s[3], authId(s[4]), s[5], s[6], s[7], 12 + (i % 7) * 3);
      // Most demo items get a made-up barcode; the last few have none so "Link this barcode" can be tried.
      if (i < ITEMS.length - 6) bc.run(`99${String(i + 1).padStart(10, '0')}`, Number(r.lastInsertRowid));
    });

    const page = db.prepare(`INSERT INTO pages (name, pos) VALUES (?, ?)`);
    ['ICE COLD BEER', 'Checks & Services', 'Gas', 'No Code Items'].forEach((p, i) => page.run(p, i));
    const pageId = (name: string) => (db.prepare(`SELECT id FROM pages WHERE name = ?`).get(name) as { id: number }).id;
    const btn = db.prepare(`INSERT INTO buttons (page_id, pos, name, price_cents, price_mode, authority_id, category, age_min, shape, fill, border, text_color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const posByPage = new Map<string, number>();
    for (const b of BUTTONS) {
      const pos = posByPage.get(b[10]) ?? 0;
      posByPage.set(b[10], pos + 1);
      btn.run(pageId(b[10]), pos, b[0], b[1], b[2], authId(b[6]), b[8], b[7], b[3], b[4], b[5], b[9]);
    }
  });
  tx();
  return true;
}
