import { describe, expect, it } from 'vitest';
import { compareVersions } from './updater.js';

describe('updater', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
  });

  it('parses the Drive folder listing markup', () => {
    const html = `<div class="flip-entry" id="entry-abc123_X" role="option"><div class="flip-entry-info"><a><div class="flip-entry-title">latest.json</div></a></div></div>
      <div class="flip-entry" id="entry-zzz9" role="option"><div class="flip-entry-title">lakecity-pos-0.2.0.zip</div></div>`;
    const re = /id="entry-([\w-]+)"[\s\S]*?flip-entry-title">([^<]+)</g;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) out.push(`${m[1]}=${m[2]}`);
    expect(out).toEqual(['abc123_X=latest.json', 'zzz9=lakecity-pos-0.2.0.zip']);
  });
});
