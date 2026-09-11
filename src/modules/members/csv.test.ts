import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvObjects, toCsv } from './csv.js';

describe('parseCsv', () => {
  it('parses simple rows with CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quoted fields, escaped quotes, and embedded newlines', () => {
    const text = 'name,note\n"Doe, Jane","said ""hi""\nthen left"\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Doe, Jane', 'said "hi"\nthen left'],
    ]);
  });

  it('keeps the Wise middle-dot detail intact', () => {
    const text = 'recipientDetail\nGCash · 639279560278\n';
    expect(parseCsv(text)[1]).toEqual(['GCash · 639279560278']);
  });

  it('drops blank lines and handles a missing trailing newline', () => {
    expect(parseCsv('a,b\n\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseCsvObjects', () => {
  it('keys rows by lower-cased trimmed headers and pads short rows', () => {
    const { headers, rows } = parseCsvObjects(' First_Name ,email\nAda\n');
    expect(headers).toEqual(['first_name', 'email']);
    expect(rows).toEqual([{ first_name: 'Ada', email: '' }]);
  });
});

describe('toCsv', () => {
  it('quotes only when needed and round-trips', () => {
    const out = toCsv(['a', 'b'], [['plain', 'has, comma'], ['q"uote', null]]);
    expect(out).toBe('a,b\r\nplain,"has, comma"\r\n"q""uote",\r\n');
    expect(parseCsv(out)).toEqual([
      ['a', 'b'],
      ['plain', 'has, comma'],
      ['q"uote', ''],
    ]);
  });
});
