// Simple product pictures used when an item has no photo yet. Picked by category, with a few name hints.

type Kind = 'bottle' | 'can' | 'cup' | 'bag' | 'candy' | 'cigs' | 'box' | 'snow' | 'oil' | 'wine' | 'water' | 'milk' | 'jerky' | 'gum' | 'pills' | 'roll' | 'battery' | 'generic';

export function pickArt(category: string, name: string): Kind {
  const n = name.toLowerCase();
  const c = category.toLowerCase();
  if (/water/.test(n)) return 'water';
  if (/milk|juice/.test(n)) return 'milk';
  if (/coffee|cup/.test(n)) return 'cup';
  if (/jerky/.test(n)) return 'jerky';
  if (/gum|mint/.test(n)) return 'gum';
  if (/tylenol|aspirin|advil|pill|tablet/.test(n)) return 'pills';
  if (/tissue|towel|roll/.test(n)) return 'roll';
  if (/batter/.test(n)) return 'battery';
  if (/chips|pretzel|popcorn|cracker|peanut|trail/.test(n)) return 'bag';
  if (/beer|lager|ale|ultra|light/.test(n) && /pack|can/.test(n)) return 'can';
  if (/beer/.test(c)) return 'can';
  if (/wine/.test(c)) return 'wine';
  if (/drink|soda/.test(c)) return 'bottle';
  if (/snack/.test(c)) return 'bag';
  if (/candy/.test(c)) return 'candy';
  if (/tobacco|cig/.test(c)) return 'cigs';
  if (/frozen|ice/.test(c)) return 'snow';
  if (/auto|oil|motor/.test(c)) return 'oil';
  if (/household|regular|grocery/.test(c)) return 'box';
  return 'generic';
}

export function CategoryArt({ category, name, size = 40 }: { category: string; name: string; size?: number }) {
  const kind = pickArt(category, name);
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (kind) {
    case 'bottle': return <svg {...p}><path d="M10 2h4v4l2.5 3.5V20a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2V9.5L10 6z" /><path d="M7.5 13h9" /><path d="M7.5 17h9" /></svg>;
    case 'water': return <svg {...p}><path d="M10 2h4v3l2 2.5V20a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V7.5L10 5z" /><path d="M9 11c1 .8 2 .8 3 0s2-.8 3 0" /><path d="M9 15c1 .8 2 .8 3 0s2-.8 3 0" /></svg>;
    case 'milk': return <svg {...p}><path d="M8 2h8v4l2 4v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V10l2-4z" /><path d="M6 10h12" /><path d="M8 6h8" /></svg>;
    case 'can': return <svg {...p}><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M7 8h10M7 16h10" /><path d="M10 5.5h4" /></svg>;
    case 'cup': return <svg {...p}><path d="M6 5h12l-1.5 16h-9z" /><path d="M6.5 9h11" /><path d="M8 3h8" /></svg>;
    case 'bag': return <svg {...p}><path d="M7 4h10l-1 2 1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2l1-13z" /><path d="M8 6h8" /><path d="M9.5 11l2 2 3-3" /></svg>;
    case 'candy': return <svg {...p}><rect x="8" y="9" width="8" height="6" rx="3" /><path d="M8 10L4 7v10l4-3" /><path d="M16 10l4-3v10l-4-3" /></svg>;
    case 'cigs': return <svg {...p}><path d="M8 6V4h8v2" /><rect x="5" y="6" width="14" height="15" rx="2" /><path d="M5 11h14" /><path d="M9 15h6" /></svg>;
    case 'box': return <svg {...p}><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4" /><path d="M12 11v10" /></svg>;
    case 'snow': return <svg {...p}><path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19" /><path d="M12 2l2 2-2 2-2-2z" /></svg>;
    case 'oil': return <svg {...p}><path d="M9 3h6v3H9z" /><path d="M7 6h10l1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z" /><path d="M17 9l4-1v4l-4 1" /></svg>;
    case 'wine': return <svg {...p}><path d="M8 3h8l-1 7a3 3 0 0 1-6 0z" /><path d="M12 13v7" /><path d="M8 21h8" /></svg>;
    case 'jerky': return <svg {...p}><path d="M5 10c2-4 12-5 14-1 1 2-1 6-4 7s-9 1-11-1 0-3 1-5z" /><path d="M9 11c2 .5 4 .5 6 0" /></svg>;
    case 'gum': return <svg {...p}><rect x="4" y="8" width="16" height="8" rx="1" /><path d="M8 8v8M12 8v8M16 8v8" /></svg>;
    case 'pills': return <svg {...p}><rect x="4" y="6" width="16" height="13" rx="2" /><path d="M4 11h16" /><circle cx="12" cy="15" r="1.6" /></svg>;
    case 'roll': return <svg {...p}><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v10c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><circle cx="12" cy="6" r="1.2" /></svg>;
    case 'battery': return <svg {...p}><rect x="4" y="8" width="15" height="8" rx="1.5" /><path d="M19 10.5h2v3h-2" /><path d="M7 10.5v3M10 10.5v3" /></svg>;
    default: return <svg {...p}><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 10h8M8 14h5" /></svg>;
  }
}
