import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionButton } from '../src/components/ActionButton';

const render = (props: Parameters<typeof ActionButton>[0] = {}) => renderToStaticMarkup(createElement(ActionButton, { children: 'Undo', ...props }));

describe('explainable unavailable actions', () => {
  it('marks an action unavailable without preventing native activation or focus', () => {
    const html = render({ blockedReason: 'Play a move first.' });
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toMatch(/\sdisabled(?:=|\s|>)/);
    expect(html).not.toContain('tabindex="-1"');
  });
  it('associates the exact explanation with the button', () => {
    const html = render({ blockedReason: 'Finished games cannot be undone.' });
    const id = html.match(/aria-describedby="([^"]+)"/)![1];
    expect(html).toContain(`id="${id}">Finished games cannot be undone.</span>`);
  });
  it('retains existing descriptions as well as the blocking reason', () => {
    const html = render({ 'aria-describedby': 'undo-help', blockedReason: 'Wait for the opponent.' });
    expect(html).toMatch(/aria-describedby="undo-help [^"]+"/);
  });
  it.each([undefined, false, ''] as const)('leaves an available action enabled for reason %s', (blockedReason) => {
    const html = render({ blockedReason });
    expect(html).not.toContain('aria-disabled');
    expect(html).not.toContain('aria-describedby');
    expect(html).not.toContain('sr-only');
  });
  it('does not erase unrelated button props', () => {
    const html = render({ id: 'undo', className: 'btn', 'aria-label': 'Undo last move', 'aria-pressed': true, blockedReason: 'No moves yet.' });
    for (const attribute of ['id="undo"', 'class="btn"', 'aria-label="Undo last move"', 'aria-pressed="true"']) expect(html).toContain(attribute);
  });
  it('escapes explanations as text rather than interpreting markup', () => {
    const html = render({ blockedReason: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
  it('does not accidentally submit a form by default', () => {
    expect(render()).toContain('type="button"');
    expect(render({ type: 'submit' })).toContain('type="submit"');
  });
});
