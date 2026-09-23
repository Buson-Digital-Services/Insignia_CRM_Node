import { describe, expect, it } from 'vitest';
import { buildDataSetXml } from './dataset-xml.util.js';

describe('buildDataSetXml', () => {
  it('wraps each row in the given tag inside a DocumentElement root', () => {
    const xml = buildDataSetXml('SCHEMES', [{ ItemCode: 'A1', Quantity: 2 }]);
    expect(xml).toBe('<DocumentElement><SCHEMES><ItemCode>A1</ItemCode><Quantity>2</Quantity></SCHEMES></DocumentElement>');
  });

  it('emits one <tag> element per row, in order', () => {
    const xml = buildDataSetXml('SCHEMES', [{ ItemCode: 'A1' }, { ItemCode: 'B2' }]);
    expect(xml).toBe('<DocumentElement><SCHEMES><ItemCode>A1</ItemCode></SCHEMES><SCHEMES><ItemCode>B2</ItemCode></SCHEMES></DocumentElement>');
  });

  it('escapes XML-significant characters in values', () => {
    const xml = buildDataSetXml('SCHEMES', [{ Customer: `A&B <"quoted'>` }]);
    expect(xml).toBe('<DocumentElement><SCHEMES><Customer>A&amp;B &lt;&quot;quoted&apos;&gt;</Customer></SCHEMES></DocumentElement>');
  });

  it('renders null/undefined values as an empty element', () => {
    const xml = buildDataSetXml('SCHEMES', [{ Balance: null, Warehouse: undefined }]);
    expect(xml).toBe('<DocumentElement><SCHEMES><Balance></Balance><Warehouse></Warehouse></SCHEMES></DocumentElement>');
  });

  it('returns an empty DocumentElement for no rows', () => {
    expect(buildDataSetXml('SCHEMES', [])).toBe('<DocumentElement></DocumentElement>');
  });
});
