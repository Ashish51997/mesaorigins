import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest globals are off, so Testing Library's auto-cleanup isn't wired — unmount
// the rendered tree after each test to keep `screen` queries scoped to one render.
afterEach(() => cleanup());

// jsdom does not implement scrollIntoView; LogbookModule calls it in an effect
// to scroll the active fill-panel group into view. Stub it so tests can render.
Element.prototype.scrollIntoView = function scrollIntoView() {
  /* no-op in jsdom */
};
