/**
 * Styles for the public landing page.
 *
 * Kept as a string in its own module, and rendered once by `page.tsx` inside a
 * `<style href precedence>` element, rather than added to `globals.css`. The
 * landing page is the only route that uses any of it, and it is the one route a
 * signed-in visitor never sees, so shipping it in the global sheet would put
 * roughly six kilobytes of marketing CSS in front of every dashboard load for
 * no benefit. React dedupes the element by `href`, so re-rendering is free.
 *
 * Everything is prefixed `tf-lp` so that adding a rule here can never reach a
 * component outside this page.
 */
export const LANDING_CSS = `
/* -------------------------------------------------------------------------- */
/* Shell                                                                      */
/* -------------------------------------------------------------------------- */

.tf-lp { display: flex; flex-direction: column; min-height: 100dvh; }
.tf-lp main { flex: 1; }

/* Screen-reader-only text. Scoped to this page rather than added to the global
   sheet so it cannot collide with a utility another surface introduces. */
.tf-lp__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* -------------------------------------------------------------------------- */
/* Rhythm and typography                                                      */
/* -------------------------------------------------------------------------- */

.tf-lp__section { padding-block: clamp(3.75rem, 9vw, 7rem); }
.tf-lp__section--alt {
  background: var(--tf-surface);
  border-block: 1px solid var(--tf-border);
}
.tf-lp__section--tight { padding-block: clamp(3rem, 6vw, 4.5rem); }

.tf-lp__kicker {
  margin: 0 0 0.75rem;
  color: var(--tf-text-muted);
  /* Blended toward the theme text so a dark brand colour still clears contrast
     on a dark background; browsers without color-mix keep the muted grey. */
  color: color-mix(in srgb, var(--tf-brand) 55%, var(--tf-text));
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.tf-lp__h2 {
  margin: 0 0 1rem;
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.025em;
  text-wrap: balance;
}

.tf-lp__lede {
  margin: 0;
  max-width: 62ch;
  color: var(--tf-text-muted);
  font-size: clamp(1rem, 1.5vw, 1.0625rem);
  line-height: 1.7;
}

.tf-lp__head {
  max-width: 54ch;
  margin: 0 auto clamp(2.5rem, 6vw, 4rem);
  text-align: center;
}
.tf-lp__head .tf-lp__lede { margin-inline: auto; }

/* -------------------------------------------------------------------------- */
/* Hero                                                                       */
/* -------------------------------------------------------------------------- */

/* Reuses .tf-hero for the glow, the centring and the clipping; only the extra
   headroom a landing hero needs is added here. */
.tf-lp__hero { padding-block: clamp(3.5rem, 11vw, 8rem) clamp(3rem, 8vw, 5rem); }

/* Sits above .tf-hero::before and the decorative layer below it. */
.tf-lp__hero-inner { position: relative; z-index: 1; }

.tf-lp__decor {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

/* A faint ruled grid, faded out toward the edges so it never reaches the
   section boundary as a hard line. Behind an @supports because without the mask
   the grid would run edge to edge and read as a table rather than a texture. */
@supports (mask-image: radial-gradient(#000, transparent)) or
          (-webkit-mask-image: radial-gradient(#000, transparent)) {
  .tf-lp__decor::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(to right, var(--tf-border) 1px, transparent 1px),
      linear-gradient(to bottom, var(--tf-border) 1px, transparent 1px);
    background-size: 56px 56px;
    -webkit-mask-image: radial-gradient(ellipse 80% 65% at 50% 0%, #000 0%, transparent 78%);
    mask-image: radial-gradient(ellipse 80% 65% at 50% 0%, #000 0%, transparent 78%);
    opacity: 0.7;
  }
}

.tf-lp__orb {
  position: absolute;
  display: block;
  border-radius: 50%;
  aspect-ratio: 1;
  filter: blur(70px);
  opacity: 0.4;
  will-change: transform;
}
.tf-lp__orb--a {
  width: min(60vw, 520px);
  top: -22%;
  left: -12%;
  background: color-mix(in srgb, var(--tf-brand) 60%, transparent);
  animation: tf-lp-drift-a 24s ease-in-out infinite;
}
.tf-lp__orb--b {
  width: min(52vw, 440px);
  top: -14%;
  right: -12%;
  background: color-mix(in srgb, var(--tf-brand-accent) 50%, transparent);
  animation: tf-lp-drift-b 31s ease-in-out infinite;
}
[data-theme='dark'] .tf-lp__orb { opacity: 0.3; }

/* Both keyframes end where they start. The global reduce-motion rule clamps
   animation-duration to 0.01ms rather than removing the animation, so a
   sequence that ended somewhere else would snap the orb to that spot. */
@keyframes tf-lp-drift-a {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(6%, 5%, 0) scale(1.1); }
}
@keyframes tf-lp-drift-b {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); }
  50% { transform: translate3d(-5%, 7%, 0) scale(1.06); }
}
@media (prefers-reduced-motion: reduce) {
  .tf-lp__orb { animation: none; }
}

.tf-lp__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 1.5rem;
  padding: 0.35rem 0.9rem;
  border: 1px solid var(--tf-border);
  border-radius: 999px;
  background: var(--tf-surface);
  color: var(--tf-text-muted);
  font-size: 0.8125rem;
  font-weight: 500;
}
.tf-lp__dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 999px;
  background: var(--tf-brand);
}

.tf-lp__title { margin: 0 0 1.25rem; }
.tf-lp__title-name {
  display: block;
  font-size: clamp(2.5rem, 7vw, 4.25rem);
  font-weight: 750;
  line-height: 1.03;
  letter-spacing: -0.035em;
  color: var(--tf-text);
}
/* The gradient stops short of the brand colour and is anchored to --tf-text,
   because the brand hue is administrator-editable and a dark one would
   otherwise leave the headline unreadable on a dark background. Both features
   are required together: without color-mix the gradient would be invalid, and
   transparent text over a dropped background-image is invisible text. */
@supports (background-clip: text) and (color: color-mix(in srgb, red 50%, blue)) {
  .tf-lp__title-name {
    background-image: linear-gradient(
      118deg,
      var(--tf-text) 30%,
      color-mix(in srgb, var(--tf-brand) 45%, var(--tf-text)) 100%
    );
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
}
.tf-lp__title-tag {
  display: block;
  max-width: 24ch;
  margin: 0.65rem auto 0;
  color: var(--tf-text-muted);
  font-size: clamp(1.125rem, 2.8vw, 1.75rem);
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.02em;
  text-wrap: balance;
}

.tf-lp__hero-lede {
  max-width: 58ch;
  margin: 0 auto 2rem;
  color: var(--tf-text-muted);
  font-size: clamp(1rem, 1.7vw, 1.125rem);
  line-height: 1.7;
}

.tf-lp__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: center;
}
.tf-lp__cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 48px;
  padding-inline: 1.5rem;
  border: 1px solid transparent;
  border-radius: var(--tf-lp-radius);
  font-size: 0.9688rem;
  font-weight: 600;
  text-decoration: none;
  transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
}
.tf-lp__cta:hover { transform: translateY(-1px); }
.tf-lp__cta--primary {
  background: var(--tf-brand);
  /* Fixed rather than a theme token: this sits on the brand fill, not on a
     surface, so it must not flip with the colour scheme. */
  color: #fff;
  box-shadow: 0 6px 20px -8px var(--tf-brand);
}
.tf-lp__cta--primary:hover { box-shadow: 0 12px 28px -10px var(--tf-brand); }
.tf-lp__cta--ghost {
  background: var(--tf-surface);
  border-color: var(--tf-border);
  color: var(--tf-text);
}
.tf-lp__cta--ghost:hover { border-color: var(--tf-text-subtle); }

.tf-lp__trust {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0.4rem 1rem;
  margin: 1.75rem 0 0;
  padding: 0;
  list-style: none;
  color: var(--tf-text-muted);
  font-size: 0.875rem;
}
/* A middot between items rather than inside them, so the last one has none and
   a wrapped row never starts with a stray separator. */
.tf-lp__trust li { display: inline-flex; align-items: center; gap: 1rem; }
.tf-lp__trust li + li::before { content: '\\0000B7'; color: var(--tf-text-subtle); }

/* -------------------------------------------------------------------------- */
/* Shared mock chrome                                                         */
/* -------------------------------------------------------------------------- */

.tf-lp__mock {
  border: 1px solid var(--tf-border);
  border-radius: clamp(12px, 2vw, 16px);
  background: var(--tf-surface);
  box-shadow: var(--tf-shadow-lg);
  overflow: hidden;
  text-align: left;
}
/* On the tinted sections the panel would otherwise be the same colour as the
   section behind it. */
.tf-lp__section--alt .tf-lp__mock { background: var(--tf-bg); }

.tf-lp__mock-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0.9rem;
  border-bottom: 1px solid var(--tf-border);
  color: var(--tf-text-muted);
  font-size: 0.8125rem;
}
.tf-lp__mock-dots { display: flex; gap: 0.35rem; flex: none; }
.tf-lp__mock-dots span {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: var(--tf-border);
}
.tf-lp__mock-body {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: clamp(0.6rem, 2.5vw, 1rem);
}
.tf-lp__mock-foot { padding-inline: 0.75rem; }

.tf-lp__preview {
  max-width: 720px;
  margin: clamp(2.5rem, 7vw, 4rem) auto 0;
}
/* The hero mock reuses .tf-task, whose own background is --tf-surface; the
   panel drops to the page colour so the rows still read as raised cards. */
.tf-lp__preview .tf-lp__mock-body { background: var(--tf-bg); }
.tf-lp__check { font-size: 1.15rem; color: var(--tf-text-subtle); line-height: 1.5; flex: none; }
.tf-lp__check--done { color: var(--tf-brand-accent); }

/* -------------------------------------------------------------------------- */
/* Feature sections                                                           */
/* -------------------------------------------------------------------------- */

.tf-lp__split {
  display: grid;
  gap: clamp(2.25rem, 5vw, 3.5rem);
  align-items: center;
}
/* Grid items default to min-width:auto, which lets a mock panel refuse to
   shrink below its widest row and push the whole page sideways at 360px. */
.tf-lp__split > * { min-width: 0; }
@media (min-width: 1024px) {
  /* minmax(0, ...) rather than 1fr: a wide mock inside a grid track would
     otherwise refuse to shrink and push the page into horizontal scroll. */
  .tf-lp__split { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: clamp(3rem, 6vw, 5rem); }
  /* Only reordered once there are two columns. Stacked, the prose must always
     come before the picture it describes. */
  .tf-lp__split--flip .tf-lp__split-copy { order: 2; }
}

/* An alias anchor. Zero-height at the top of its section, so jumping to it and
   jumping to the section itself land in the same place. */
.tf-lp__anchor { display: block; height: 0; }

.tf-lp__split-copy p { margin: 0 0 1rem; }
.tf-lp__split-copy p:last-of-type { margin-bottom: 0; }

.tf-lp__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin-bottom: 1.25rem;
  border-radius: 13px;
  background: var(--tf-border-subtle);
  background: color-mix(in srgb, var(--tf-brand) 12%, transparent);
  color: var(--tf-text);
  color: color-mix(in srgb, var(--tf-brand) 62%, var(--tf-text));
  font-size: 1.2rem;
}

.tf-lp__bullets {
  display: grid;
  gap: 0.7rem;
  margin: 1.75rem 0 0;
  padding: 0;
  list-style: none;
}
.tf-lp__bullets li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.6rem;
  align-items: start;
  color: var(--tf-text-muted);
  font-size: 0.9375rem;
  line-height: 1.6;
}
.tf-lp__bullets .anticon {
  margin-top: 0.28em;
  color: var(--tf-text-subtle);
  color: color-mix(in srgb, var(--tf-brand-accent) 70%, var(--tf-text));
}

/* -------------------------------------------------------------------------- */
/* Feature visuals                                                            */
/* -------------------------------------------------------------------------- */

.tf-lp__row {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--tf-border);
  border-radius: 10px;
  background: var(--tf-surface);
  font-size: 0.875rem;
}
.tf-lp__row--stack { display: block; }
.tf-lp__row-main { flex: 1; min-width: 0; }
.tf-lp__row-title { margin: 0; font-weight: 550; overflow-wrap: anywhere; }
.tf-lp__row-title--spaced { margin-bottom: 0.5rem; }
.tf-lp__row-note { margin: 0.1rem 0 0; color: var(--tf-text-muted); font-size: 0.8125rem; }

.tf-lp__ext {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 9px;
  background: var(--tf-border-subtle);
  color: var(--tf-text-muted);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.tf-lp__pill {
  flex: none;
  padding: 0.1rem 0.55rem;
  border: 1px solid var(--tf-border);
  border-radius: 999px;
  color: var(--tf-text-muted);
  font-size: 0.75rem;
  white-space: nowrap;
}

.tf-lp__formats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
  gap: 0.6rem;
}
.tf-lp__format {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.75rem 0.6rem;
  border: 1px solid var(--tf-border);
  border-radius: 11px;
  background: var(--tf-surface);
  text-align: center;
}
.tf-lp__format b { font-size: 0.9375rem; letter-spacing: 0.01em; }
.tf-lp__format span { color: var(--tf-text-muted); font-size: 0.75rem; }

/* A switch drawn in CSS rather than an antd Switch: the real control is
   focusable, and this whole panel sits inside aria-hidden, where a tab stop
   would be a keyboard trap with nothing to announce it. */
.tf-lp__switch {
  flex: none;
  width: 38px;
  height: 22px;
  padding: 3px;
  border-radius: 999px;
  background: var(--tf-border);
  display: flex;
  justify-content: flex-start;
}
.tf-lp__switch span {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--tf-surface);
  box-shadow: var(--tf-shadow);
}
.tf-lp__switch--on { background: var(--tf-brand); justify-content: flex-end; }
/* Fixed white for the same reason as the primary button's label: the knob sits
   on the brand fill, not on a surface, so it must not flip with the theme. */
.tf-lp__switch--on span { background: #fff; }

.tf-lp__url {
  display: block;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--tf-border);
  border-radius: 9px;
  background: var(--tf-border-subtle);
  color: var(--tf-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.tf-lp__chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.tf-lp__chip {
  padding: 0.2rem 0.6rem;
  border: 1px solid var(--tf-border);
  border-radius: 999px;
  background: var(--tf-surface);
  color: var(--tf-text-muted);
  font-size: 0.8125rem;
}
.tf-lp__chip--on {
  border-color: transparent;
  background: color-mix(in srgb, var(--tf-brand) 14%, transparent);
  color: var(--tf-text);
  color: color-mix(in srgb, var(--tf-brand) 62%, var(--tf-text));
  font-weight: 600;
}

.tf-lp__meter {
  height: 7px;
  border-radius: 999px;
  background: var(--tf-border-subtle);
  overflow: hidden;
}
.tf-lp__meter span { display: block; height: 100%; border-radius: 999px; background: var(--tf-brand); }

/* -------------------------------------------------------------------------- */
/* How it works                                                               */
/* -------------------------------------------------------------------------- */

.tf-lp__steps {
  display: grid;
  gap: clamp(1.75rem, 4vw, 2.5rem);
  grid-template-columns: repeat(auto-fit, minmax(min(255px, 100%), 1fr));
  margin: 0;
  padding: 0;
  list-style: none;
}
.tf-lp__step { padding-top: 1.1rem; border-top: 2px solid var(--tf-border); }
.tf-lp__step-num {
  display: block;
  margin-bottom: 0.6rem;
  color: var(--tf-text-muted);
  color: color-mix(in srgb, var(--tf-brand) 55%, var(--tf-text));
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
}
.tf-lp__step h3 { margin: 0 0 0.5rem; font-size: 1.125rem; font-weight: 650; letter-spacing: -0.01em; }
.tf-lp__step p { margin: 0; color: var(--tf-text-muted); font-size: 0.9375rem; line-height: 1.7; }

/* -------------------------------------------------------------------------- */
/* Specifications                                                             */
/* -------------------------------------------------------------------------- */

/* The 1px gap over a border-coloured background draws the hairline rules, so
   the grid keeps its dividers however many columns it reflows to. */
.tf-lp__specs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr));
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--tf-border);
  border-radius: 18px;
  background: var(--tf-border);
  overflow: hidden;
}
.tf-lp__spec { background: var(--tf-surface); padding: clamp(1.25rem, 3vw, 1.75rem); }
.tf-lp__spec-value {
  margin: 0;
  font-size: clamp(1.5rem, 3vw, 2rem);
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.025em;
  overflow-wrap: anywhere;
}
.tf-lp__spec-label {
  margin: 0.45rem 0 0.6rem;
  color: var(--tf-text-muted);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.tf-lp__spec-note { margin: 0; color: var(--tf-text-muted); font-size: 0.875rem; line-height: 1.65; }

/* -------------------------------------------------------------------------- */
/* Closing                                                                    */
/* -------------------------------------------------------------------------- */

.tf-lp__closing {
  position: relative;
  overflow: hidden;
  padding: clamp(2.5rem, 7vw, 4.5rem) clamp(1.25rem, 5vw, 3rem);
  border: 1px solid var(--tf-border);
  border-radius: 22px;
  background: var(--tf-surface);
  text-align: center;
}
.tf-lp__closing::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--tf-hero-glow);
  pointer-events: none;
}
.tf-lp__closing > * { position: relative; }
.tf-lp__closing .tf-lp__lede { margin: 0 auto 2rem; max-width: 50ch; }
.tf-lp__closing-note { margin: 1.75rem 0 0; color: var(--tf-text-muted); font-size: 0.875rem; }
.tf-lp__closing-note a { color: inherit; text-underline-offset: 3px; }
.tf-lp__closing-note a:hover { color: var(--tf-text); }
`;
