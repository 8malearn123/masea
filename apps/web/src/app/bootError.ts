import { BRAND } from '@masiat/shared';

/**
 * Last-resort boot screen, painted with plain DOM and inline styles.
 *
 * It must not depend on React, the router, Tailwind or any app module: it runs
 * exactly in the cases where one of those failed to load. Anything a blank
 * white page would have hidden shows up here instead.
 */
export function renderBootError(root: HTMLElement, title: string, detail: string): void {
  const { navy, gold, purple } = BRAND.colors;

  root.innerHTML = '';
  root.setAttribute('dir', 'rtl');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'font-family:Alexandria,system-ui,sans-serif',
    'max-width:44rem',
    'margin:4rem auto',
    'padding:2rem',
    'border-radius:1rem',
    `border:1px solid ${purple}33`,
    'background:#fff',
    'box-shadow:0 8px 30px rgba(0,0,0,.08)',
    'line-height:1.9',
  ].join(';');

  const heading = document.createElement('h1');
  heading.textContent = title;
  heading.style.cssText = `color:${navy};font-size:1.25rem;margin:0 0 .5rem`;

  const lead = document.createElement('p');
  lead.textContent = 'التطبيق لم يبدأ. التفاصيل التقنية أدناه:';
  lead.style.cssText = `color:${purple};margin:0 0 1rem;font-size:.9rem`;

  const pre = document.createElement('pre');
  pre.textContent = detail;
  pre.style.cssText = [
    'font-family:"JetBrains Mono",ui-monospace,monospace',
    'direction:ltr',
    'text-align:left',
    'white-space:pre-wrap',
    'word-break:break-word',
    'font-size:.8rem',
    'background:#f6f6fa',
    'padding:1rem',
    'border-radius:.5rem',
    'margin:0',
    `border-right:3px solid ${gold}`,
  ].join(';');

  panel.append(heading, lead, pre);
  root.append(panel);
}
