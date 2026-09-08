import "@testing-library/jest-dom/vitest";

/**
 * jsdom implements no layout, so it ships no `ResizeObserver` — and several
 * Radix primitives (`Checkbox` through `useSize`, and the popover-shaped ones
 * through their positioning) construct one on mount. Without this they throw
 * `ResizeObserver is not defined` during render, which fails the test for a
 * reason that has nothing to do with what it asserts.
 *
 * A no-op rather than a polyfill that measures: there is nothing to measure in
 * jsdom, every box is 0×0, and a fake that reported sizes would invite tests to
 * assert on numbers no browser produced. Anything genuinely about layout does
 * not belong in this environment at all.
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= NoopResizeObserver;
