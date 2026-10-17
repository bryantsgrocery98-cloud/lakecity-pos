// Shapes shared by the server and the touch UI.
import type { Authority } from './tax.js';
import type { Totals } from './ticket.js';

export type Role = 'cashier' | 'manager' | 'owner';

export type ButtonShape = 'can' | 'six' | 'twelve' | 'eighteen' | 'bag' | 'cup' | 'box';

export type ItemDto = {
  id: number;
  name: string;
  size: string | null;
  priceCents: number;
  category: string;
  authorityId: number | null;
  ageMin: number | null;
  color: string;
  frequent: boolean;
  hasBarcode: boolean;
  imageVersion: number;
  /** Multi-buy deal, e.g. 2 for $1.00. */
  dealQty: number | null;
  dealCents: number | null;
};

export type ButtonDto = {
  id: number;
  name: string;
  priceCents: number;
  priceMode: 'fixed' | 'ask';
  authorityId: number | null;
  category: string;
  ageMin: number | null;
  shape: ButtonShape;
  fill: string;
  border: string;
  textColor: string;
};

export type PageDto = { id: number; name: string; buttons: ButtonDto[] };

export type StoreDto = { name: string; address: string; phone: string; footer: string; refundPolicy: string };

export type SettingsDto = {
  discountButtons: number[];
  warnQty: number;
  warnTotalCents: number;
  scanIdOnly: boolean;
  /** Default check-cashing fee, in cents (the cashier can change it per check). */
  checkFeeCents: number;
  /** Whether stock counts are shown and kept. */
  trackStock: boolean;
};

export type Bootstrap = {
  store: StoreDto;
  settings: SettingsDto;
  authorities: Authority[];
  pages: PageDto[];
  items: ItemDto[];
  holdCount: number;
  version: string;
};

export type SaleLineInput = {
  kind: 'item' | 'button' | 'ask' | 'lottery' | 'service';
  itemId?: number;
  buttonId?: number;
  /** For service lines: which service. */
  service?: 'gas' | 'check_fee';
  /** For a check-cashing fee line: the amount of the check being cashed. */
  baseCents?: number;
  qty: number;
  /** Only used for ask-price and lottery lines. The server prices everything else. */
  unitCents?: number;
};

export type AgeCheckInput = {
  method: 'scan' | 'manual_dob' | 'manager_override';
  result: 'passed' | 'failed';
  managerPin?: string;
};

export type SaleInput = {
  cashier: string;
  discountPct: number;
  lines: SaleLineInput[];
  payment: { tender: 'cash' | 'card' | 'check' | 'tab'; tenderedCents?: number; reference?: string; customerId?: number };
  ageCheck?: AgeCheckInput;
};

export type Receipt = {
  receiptNo: string;
  createdAt: string;
  cashier: string;
  store: StoreDto;
  lines: { name: string; qty: number; unitCents: number; grossCents: number; discountCents: number }[];
  totals: Totals;
  payment: { tender: 'cash' | 'card' | 'check' | 'tab'; amountCents: number; tenderedCents: number | null; changeCents: number | null; reference: string | null; customerName?: string | null; tabBalanceCents?: number | null };
};

export type HoldDto = {
  id: number;
  label: string;
  cashier: string;
  createdAt: string;
  discountPct: number;
  lines: unknown[];
};

export type CustomerDto = { id: number; name: string; phone: string | null; note: string | null; balanceCents: number; lastAt: string | null; active: boolean };
