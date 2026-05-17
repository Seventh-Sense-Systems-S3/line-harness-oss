import { describe, expect, test } from 'vitest';
import { renderMessageContent } from './render-message.js';

describe('renderMessageContent', () => {
  test('replaces {{liff_id}} with given liffId', () => {
    expect(renderMessageContent('hello https://liff.line.me/{{liff_id}}/x', '12345-AAA'))
      .toBe('hello https://liff.line.me/12345-AAA/x');
  });

  test('replaces all occurrences', () => {
    expect(renderMessageContent('a={{liff_id}} b={{liff_id}}', 'X'))
      .toBe('a=X b=X');
  });

  test('returns input unchanged when no placeholder', () => {
    expect(renderMessageContent('no placeholder', 'X')).toBe('no placeholder');
  });

  test('returns input unchanged when liffId is null', () => {
    expect(renderMessageContent('a {{liff_id}} b', null)).toBe('a {{liff_id}} b');
  });

  test('returns input unchanged when liffId is empty string', () => {
    expect(renderMessageContent('a {{liff_id}} b', '')).toBe('a {{liff_id}} b');
  });

  test('handles event path embedded in URL template', () => {
    const tpl = 'イベント詳細→ https://liff.line.me/{{liff_id}}/?page=event&id=evt-1';
    expect(renderMessageContent(tpl, 'LIFF-9999')).toBe(
      'イベント詳細→ https://liff.line.me/LIFF-9999/?page=event&id=evt-1',
    );
  });
});
