# Animation rules — West End Chiropractic (GSAP)

Established conventions for `animations/gsap.js`. Follow these for any new
section animation on this site.

## Fail-open on missing GSAP

The site uses a flicker-prevention CSS rule in the hero/section embeds:

```css
html:not(.gsap-not-found) [data-prevent-flicker='true'] { visibility: hidden; }
```

Content marked `data-prevent-flicker="true"` stays hidden until GSAP reveals
it (`gsap.set(root, { visibility: "visible" })`). If the GSAP CDN script
fails to load, nothing would ever run that `gsap.set` call, so the content
would stay invisible forever. `gsap.js` guards against this at the very top,
before anything else runs:

```js
if (typeof gsap === "undefined") {
    document.documentElement.classList.add("gsap-not-found");
}
```

This flips the CSS rule's selector off immediately, so missing GSAP always
fails open to visible content, never stuck hidden. Any new animated section
must carry both `data-animation-trigger="<name>"` and
`data-prevent-flicker="true"` on its root element, added in Webflow Designer
before the GSAP code is written.

## Section setup pattern

Every animated section follows the same shape:

1. Find the root via `document.querySelector('[data-animation-trigger="<name>"]')`
   (or `querySelectorAll` + `.forEach` if the trigger can repeat on a page,
   as with reusable content sections).
2. `gsap.set(sectionRoot, { visibility: "visible" })` to reveal it.
3. Grab child elements by their real Webflow class names — never assume a
   DOM position or copy a selector from a different component without
   checking the actual markup first, since similarly-named components can
   have different internal structure page to page.
4. Build one `gsap.timeline({ scrollTrigger: { trigger: sectionRoot, start: "top 80%", once: true } })`.
5. `.set(...)` every animated element to its start state at time `0` before
   any `.to(...)` calls, so the section never flashes its resting state
   before the animation begins.
6. Chain `.to(...)` calls with explicit absolute timeline positions (e.g.
   `0.5`, not relative `"+=0.2"`), so timing is easy to read and retune as a
   whole sequence.

## Word-mask heading reveal (`splitHeadingIntoWords`)

Shared by every section with an animated heading. Do not duplicate this
logic — call the existing function.

- Splits heading text into per-word `<span class="word-mask">` (the clipping
  box, `overflow:hidden`) wrapping `<span class="word-inner">` (the element
  that actually translates/rotates).
- **Accessibility**: before splitting, the original text is captured, then
  all the heading's real children are moved into one `aria-hidden="true"`
  wrapper span before the per-word spans are built inside it. Screen readers
  get one clean read of the real sentence; the fragmented word-mask markup is
  invisible to assistive tech. On a real `h1`-`h6` the text is set as
  `aria-label`; on a `p` or `div` styled as a heading (where `aria-label` is
  not permitted) a visually hidden copy of the text is added instead.
  Never split a heading without this step.

## Reduced motion

`prefers-reduced-motion: reduce` skips every section animation. The init
adds the `gsap-not-found` class and returns, which lifts the flicker-prevention
hiding so the finished page shows immediately. Any new animation added inside
the main `runWhenReady` block is covered automatically; do not add animation
code outside it.
- Animated with `yPercent: 115 → 0` plus a few degrees of `rotate` settling
  to `0`, `power4.out` ease, small stagger (~0.04s) per word. Never animate
  individual characters — only whole words; character-level splitting reads
  as a cheap effect at body/heading sizes used here.
- Idempotent: checks `h2.dataset.split` so it never re-splits an
  already-split heading (guards against being called twice).

## Hero backdrop (`animateHeroBackdrop`)

Shared by both hero sections (`hero-main`, `services-hero`).

- The hero's bg image markup has two `<img class="hero_bg_image">` variants
  (`data-hero-image="mobile"` / `"desktop"`), switched by a CSS container
  query on the section's own width — **not** a fixed DOM position. Always
  select the currently-visible one at runtime:
  ```js
  const topImage = [...heroRoot.querySelectorAll(".hero_bg_image")]
      .find((img) => getComputedStyle(img).display !== "none");
  ```
  Never assume "last in DOM" or "first in DOM" — the real markup order is
  not guaranteed and has differed between pages.
- Breakpoint checks for sizing/timing differences mirror the section's own
  **container-query** breakpoint (64em), not `window.matchMedia` on the
  viewport, since the CSS switches off the section's inline size:
  ```js
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const isMobile = heroRoot.getBoundingClientRect().width < 64 * rootFontSize;
  ```
- The image settles in from a slight zoom (`scale: 1.08 → 1` desktop,
  `0.92 → 1` mobile) with `autoAlpha`. **Any `_bg_overlay` element
  (`.hero_bg_overlay`, `.cta_bg_overlay`, and any future one) is never
  animated in GSAP** — its gradient and opacity are fully CSS-driven and
  must stay that way (explicit instruction: do not animate the overlay in
  GSAP). This applies everywhere a bg-image + overlay pair shows up, not
  just the hero — `animateHeroBackdrop` only ever touches the `_bg_image`
  element it's passed, and new sections must keep that boundary: select and
  animate the image, never reach for its sibling overlay.
- A clip-path top-to-bottom wipe was tried for the hero backdrop reveal and
  rejected (style didn't land) — stick with the zoom/autoAlpha settle for
  hero backgrounds specifically. Clip-path wipes are reserved for the
  content images below (gallery/causes sections), not the hero bg.

## Content-image clip-path wipes (gallery & causes sections)

Used for `.services_who_visual_wrap` (gallery, two images) and
`.services_causes_visual` (causes, one image). Not used on the hero bg.

- Each image wrap clips open via `clipPath: inset(...)`, going from fully
  closed on one edge to fully open. Vary the wipe direction per image when
  there's more than one in a section (e.g. large wipes left→right, small
  wipes right→left) so paired images don't feel like one mechanical repeat.
- **Always include `round <radius>px`** in every `inset()` value, matching
  the wrap's real computed `border-radius` (checked via `getComputedStyle`,
  not guessed). Without it the corners square off while the clip shape
  animates, even though the box has rounded corners at rest and at the final
  frame. Get this value before writing the animation, it is not always 16px.
- Counter-animate the `<img>` inside the wrap at the same time as the
  wrap's clip: start it scaled up slightly (`scale: 1.15`) and shifted a few
  percent in the opposite direction of the wipe (`xPercent`), then animate
  both back to `scale: 1, xPercent: 0`. This makes the image read as
  **uncovered** by the wipe rather than a flat box growing open — the single
  most important part of making this effect feel intentional rather than a
  slider demo.
- Pace these wipes to land roughly alongside the end of the text sequence
  (headline/copy/button), not finish early. Start them early in the
  timeline (around the same time as the headline reveal) but give them
  longer durations (~1.1–1.4s) than the original quick version, so the
  wipe's completion doesn't visually race ahead of the copy still settling.

## Easing vocabulary (keep distinct per role)

Reused across every section — do not default to one ease everywhere:

- Small quiet UI (eyebrow tag, badge, icon fade-in): `power2.out` /
  `power3.out`, short duration (~0.45–0.6s).
- Headline word reveal: `power4.out`, slightly longer (~0.9s), with stagger.
- Body paragraph: `power1.out` — the slowest, plainest ease; it's secondary
  content and should feel calm, not punchy.
- Buttons: `back.out(1.4)` for a touch of anticipation — never a literal
  bounce or scale-overshoot that reads as cartoonish.
- Dividers (scaleX line-draw): `power3.inOut`.
- Clip-path wipes: `power4.inOut` for the clip, `power3.out` for the
  counter-scale/shift on the image inside it.

## Testing method

Before calling an animation done, verify live in a real browser, not just by
reading the code:

1. Inject the GSAP timeline code directly into the live page via the
   browser tool's JS execution (build a `paused: true` timeline assigned to
   a `window.*` variable).
2. Scrub `.progress(n)` across several values (e.g. 0.05, 0.3, 0.6, 1) and
   screenshot/zoom each one — never trust a single end-state screenshot.
3. Check `getComputedStyle(...)` directly on the animated property
   (`clipPath`, `opacity`, `transform`) when a screenshot looks wrong, before
   concluding something is broken — screenshot timing/scroll-position
   mismatches in the test harness have produced false "stuck" readings more
   than once; the real DOM state is the source of truth, not the screenshot.
4. When re-testing in the same tab across multiple turns, old `window._tl*`
   timelines and their tweens can still be alive and fighting the new one
   over the same properties. If a freshly-built timeline doesn't visibly
   move, reload the page for a clean slate rather than trying to debug
   phantom leftover tweens.
5. A live-page edit only reflects on `*.webflow.io` after the Webflow site
   is published — Designer attribute/content changes are not visible on the
   staging URL until then.
