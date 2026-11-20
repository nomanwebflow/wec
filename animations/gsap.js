if (typeof gsap === "undefined") {
    document.documentElement.classList.add("gsap-not-found");
}

function runWhenReady(fn) {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
        fn();
    }
}

function runWhenLoaded(fn) {
    if (document.readyState === "complete") {
        fn();
    } else {
        window.addEventListener("load", fn, { once: true });
    }
}

runWhenReady(() => {
    if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
        document.documentElement.classList.add("gsap-not-found");
        return;
    }
    gsap.registerPlugin(ScrollTrigger);

    // Track every pending reveal check so any ScrollTrigger.refresh() or late
    // scroll restoration can immediately settle sections/cards that landed at
    // or above their trigger line without waiting for a scroll event.
    const pendingReveals = [];

    // Each check returns true once settled so flush can drop it — keeps the
    // indefinite low-rate poll cheap instead of walking every section forever.
    function flushPendingReveals() {
        for (let i = pendingReveals.length - 1; i >= 0; i -= 1) {
            if (pendingReveals[i]()) pendingReveals.splice(i, 1);
        }
    }

    // ScrollTrigger's own onEnter only fires on a continuous scroll that
    // actually crosses a trigger's start line on a tracked frame. A fast or
    // instant jump (scrollTo, an anchor link, keyboard End, programmatic
    // restore) can land past a section's start and end with the native
    // "scroll" event never firing at all, so onEnter never runs and a
    // once-only reveal never happens — confirmed in testing, where neither
    // "scroll" nor requestAnimationFrame fired reliably in a backgrounded
    // automation tab even though document.hidden reported false. setInterval
    // keeps running regardless of that throttling, so the fallback poll uses
    // it instead of rAF: it re-checks every pending section's own rect-based
    // checkPosition on a short interval for the first few seconds after load
    // (when a jump is most likely — an anchor link or scroll restoration
    // lands immediately), then keeps polling at a much lower rate
    // indefinitely as a final safety net, since the array is tiny and each
    // check is just a couple of getBoundingClientRect reads.
    window.addEventListener("scroll", flushPendingReveals, { passive: true });

    // Nothing ever removes a settled section's check from pendingReveals —
    // each one is a cheap no-op once settled (it returns immediately), so
    // there's no need to track or short-circuit on an empty array here.
    const pollStart = Date.now();
    let pollTimer = setInterval(() => {
        flushPendingReveals();
        if (!pendingReveals.length || Date.now() - pollStart >= 3000) {
            clearInterval(pollTimer);
            pollTimer = pendingReveals.length ? setInterval(flushPendingReveals, 750) : null;
        }
    }, 150);

    function revealSectionOnScroll(sectionRoot, tl, start = "top 80%") {
        let settled = false;
        let trigger = null;
        let checkCount = 0;

        const settle = (skipToEnd) => {
            if (settled) return;
            settled = true;

            if (skipToEnd) {
                tl.progress(1);
            } else {
                // .play() alone only schedules the next GSAP ticker tick; force
                // one synchronous render now so the visibility/set state lands
                // immediately rather than waiting on the next rAF-driven tick.
                tl.progress(0).play();
                gsap.ticker.tick();
            }

            if (trigger) {
                const st = trigger;
                trigger = null;
                // Defer kill so we never mutate ScrollTrigger's internal array
                // while ScrollTrigger.refresh() is iterating over it.
                gsap.delayedCall(0, () => st.kill());
            }
        };

        const checkPosition = () => {
            if (settled) return true;
            checkCount += 1;
            const rect = sectionRoot.getBoundingClientRect();
            const vh = window.innerHeight || document.documentElement.clientHeight;

            // "Already scrolled completely past" only means something once the
            // page's own layout has settled. On the very first check — called
            // synchronously while ScrollTrigger.create() is still running at
            // DOMContentLoaded — every section above this one may still be its
            // pre-image collapsed height, so a low section like a closing CTA
            // can measure as rect.bottom <= 0 against a page that LOOKS short
            // but isn't really. Treating that as "scrolled past" here would
            // permanently settle (and kill the trigger for) a section nobody
            // has scrolled past yet, leaving it stuck hidden forever once
            // real layout kicks in. So the bottom<=0 fast-path only applies
            // from the second check onward (a real refresh/resize/scroll
            // event), never the first.
            if (checkCount > 1 && rect.bottom <= 0) {
                settle(true);
                return true;
            }

            if (rect.top <= vh * 0.8) {
                settle(false);
            }
            return settled;
        };

        // Do not pass `once: true` here: GSAP 3.15 can recursively refresh and
        // self-kill earlier `once: true` triggers during subsequent trigger
        // creation, shrinking its internal array mid-loop and throwing
        // "Cannot read properties of undefined (reading 'end')".
        const st = ScrollTrigger.create({
            trigger: sectionRoot,
            start,
            onEnter: () => {
                const rect = sectionRoot.getBoundingClientRect();
                settle(rect.bottom <= 0);
            },
            onEnterBack: () => settle(false),
            onRefresh: checkPosition
        });
        trigger = st;

        // If onRefresh already settled this trigger synchronously during
        // ScrollTrigger.create(), `trigger` was still null inside settle();
        // schedule cleanup now.
        if (settled) {
            trigger = null;
            gsap.delayedCall(0, () => st.kill());
        } else {
            pendingReveals.push(checkPosition);
            checkPosition();
        }
    }

    function splitHeadingIntoWords(heroRoot, headingSelector) {
        const heading = heroRoot.querySelector(headingSelector);
        // Usually the selector resolves to a wrapper div containing the real
        // h1-h3/p; some headings (a plain div carrying heading text directly,
        // an h3 with no wrapper, or a styled div with no heading tag at all)
        // ARE the text element themselves, so fall back to the matched
        // element itself when it has no such child.
        const h2 = heading && (heading.matches("h1, h2, h3, p") ? heading : heading.querySelector("h1, h2, h3, p") || heading);
        // Scoped to this heading's own subtree, not the whole heroRoot — a
        // section can split more than one heading (e.g. the main title plus
        // two smaller ones), and they all share the .word-inner class, so a
        // heroRoot-wide query would return every split heading's words
        // pooled together instead of just this call's own.
        if (!h2) return [];
        if (h2.dataset.split) return h2.querySelectorAll(".word-inner");

        // Screen readers get the original text via aria-label; the split
        // markup that builds the word-mask animation is hidden from them so
        // nothing gets read out word-by-word or garbled by the extra spans.
        const fullText = h2.textContent;
        h2.setAttribute("aria-label", fullText);

        const visual = document.createElement("span");
        visual.setAttribute("aria-hidden", "true");
        while (h2.firstChild) visual.appendChild(h2.firstChild);
        h2.appendChild(visual);

        const walker = document.createTreeWalker(visual, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        let node;
        while ((node = walker.nextNode())) textNodes.push(node);

        textNodes.forEach((textNode) => {
            const parts = textNode.textContent.split(/(\s+)/);
            const frag = document.createDocumentFragment();
            parts.forEach((part) => {
                if (part.trim() === "") {
                    frag.appendChild(document.createTextNode(part));
                    return;
                }
                const mask = document.createElement("span");
                mask.className = "word-mask";
                mask.style.cssText =
                    "display:inline-block;overflow:hidden;vertical-align:top;padding-bottom:0.15em;margin-bottom:-0.15em;";
                const inner = document.createElement("span");
                inner.className = "word-inner";
                inner.style.display = "inline-block";
                inner.textContent = part;
                mask.appendChild(inner);
                frag.appendChild(mask);
            });
            textNode.parentNode.replaceChild(frag, textNode);
        });
        h2.dataset.split = "true";
        return h2.querySelectorAll(".word-inner");
    }

    function animateHeroBackdrop(tl, heroRoot, bgImageClass) {
        bgImageClass = bgImageClass || "hero_bg_image";
        // DOM order of the mobile/desktop bg images isn't fixed — the CSS picks
        // which one is on screen per breakpoint via a data attribute, so animate
        // whichever one is actually visible, never a fixed DOM position.
        const topImage = [...heroRoot.querySelectorAll("." + bgImageClass)].find(
            (img) => img.tagName === "IMG" && getComputedStyle(img).display !== "none"
        );
        if (!topImage) return;

        // Mirror the hero's own container-query breakpoint (64em) rather than
        // the viewport, since the CSS switches the bg image/layout off the
        // section's own inline size, not window width.
        const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
        const isMobile = heroRoot.getBoundingClientRect().width < 64 * rootFontSize;
        const imageStartScale = isMobile ? 0.92 : 1.08;

        tl.set(topImage, { scale: imageStartScale, autoAlpha: 0 }, 0)
            // Image settles from a slight zoom. Overlay is CSS-driven, never animated here.
            .to(topImage, { autoAlpha: 1, scale: 1, duration: 1.3, ease: "power2.out" }, 0);
    }

    // Every clip-path wipe below rounds its corners with "round 1rem" so the
    // wrap's own border radius survives the animation. Same radius at every
    // size by default; mobileRadiusRem lets one call site use a smaller radius
    // on mobile instead (only the Who section's image pair does this).
    function roundedClip(insetValues, radiusRem = 1, mobileRadiusRem = radiusRem) {
        const isBelow53rem = !window.matchMedia("(min-width: 53rem)").matches;
        const radius = isBelow53rem ? mobileRadiusRem : radiusRem;
        return `inset(${insetValues} round ${radius}rem)`;
    }

    // Timeline list wipe only: same rule, checked via an actual media query
    // (not the shared width math above) per its own breakpoint.
    function roundedClipTimeline(insetValues, radiusRem = 1) {
        const isBelow53rem = !window.matchMedia("(min-width: 53rem)").matches;
        const radius = isBelow53rem ? 0 : radiusRem;
        return `inset(${insetValues} round ${radius}rem)`;
    }

    // --- Main homepage hero: eyebrow tag -> headline -> copy -> buttons -> divider -> badge -> features ---
    (function initHeroMain() {
        const heroRoot = document.querySelector('[data-animation-trigger="hero-main"]');
        if (!heroRoot) return;

        const tag = heroRoot.querySelector(".tag_wrap");
        const copy = heroRoot.querySelector(".u-text.u-rich-text");
        const buttons = heroRoot.querySelectorAll(".u-button-wrapper .button_main_wrap");
        const divider = heroRoot.querySelector(".hero_main_divider");
        const badge = heroRoot.querySelector(".reviews-badge_outer");
        const features = heroRoot.querySelectorAll(".icon-label_wrap");
        const words = splitHeadingIntoWords(heroRoot, ".hero_main_content .u-heading");

        const tl = gsap.timeline({ paused: true });

        animateHeroBackdrop(tl, heroRoot);

        // Set visibility in the same tick as every hidden start state, so the
        // section never becomes visible before its animation is ready to run.
        tl.set(heroRoot, { visibility: "visible" }, 0)
            .set(words, { yPercent: 115, rotate: 3 }, 0)
            .set(tag, { opacity: 0, x: -8 }, 0)
            .set(copy, { opacity: 0, y: 14 }, 0)
            .set(buttons, { opacity: 0, y: 10 }, 0)
            .set(divider, { scaleX: 0, transformOrigin: "left center" }, 0)
            .set(badge, { opacity: 0, y: 10 }, 0)
            .set(features, { opacity: 0, y: 10 }, 0)
            // Eyebrow tag slides in fast and quiet, overlapping the backdrop settle.
            .to(tag, { opacity: 1, x: 0, duration: 0.45, ease: "power2.out" }, 0.35)
            // Headline rises word by word out of its mask, slight tilt settling to level.
            .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0.45)
            // Paragraph settles in slower and plainer — it's secondary, not a feature.
            .to(copy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 0.85)
            // Buttons land with a touch of anticipation, no cartoon bounce.
            .to(buttons, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "back.out(1.4)" }, 0.98)
            // Divider draws open left-to-right, then the proof row drops in after it.
            .to(divider, { scaleX: 1, duration: 0.5, ease: "power3.inOut" }, 1.15)
            .to(badge, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, 1.3)
            .to(features, { opacity: 1, y: 0, duration: 0.45, stagger: 0.08, ease: "power2.out" }, 1.4);

        revealSectionOnScroll(heroRoot, tl);
    })();

    // --- Services/condition page hero: badge -> headline -> copy -> buttons -> divider -> features ---
    (function initHeroServices() {
        const heroRoot = document.querySelector('[data-animation-trigger="services-hero"]');
        if (!heroRoot) return;

        const layout = heroRoot.querySelector(".hero_secondary_layout");
        const badge = heroRoot.querySelector(".reviews-badge_outer");
        const copy = heroRoot.querySelector(".u-text.u-rich-text");
        const buttons = heroRoot.querySelectorAll(".u-button-wrapper .button_main_wrap");
        const divider = heroRoot.querySelector(".hero_secondary_divider");
        const features = heroRoot.querySelectorAll(".icon-label_wrap");
        const words = splitHeadingIntoWords(layout, ".u-heading");

        const tl = gsap.timeline({ paused: true });

        animateHeroBackdrop(tl, heroRoot);

        tl.set(heroRoot, { visibility: "visible" }, 0)
            .set(badge, { opacity: 0, y: 10 }, 0)
            .set(words, { yPercent: 115, rotate: 3 }, 0)
            .set(copy, { opacity: 0, y: 14 }, 0)
            .set(buttons, { opacity: 0, y: 10 }, 0)
            .set(divider, { scaleX: 0, transformOrigin: "left center" }, 0)
            .set(features, { opacity: 0, y: 10 }, 0)
            // Badge leads here — it sits above the headline in this layout.
            .to(badge, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }, 0.35)
            // Headline rises word by word out of its mask, slight tilt settling to level.
            .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0.5)
            // Paragraph settles in slower and plainer — it's secondary, not a feature.
            .to(copy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 0.9)
            // Buttons land with a touch of anticipation, no cartoon bounce.
            .to(buttons, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "back.out(1.4)" }, 1.03)
            // Divider draws open left-to-right, then the features row drops in after it.
            .to(divider, { scaleX: 1, duration: 0.5, ease: "power3.inOut" }, 1.2)
            .to(features, { opacity: 1, y: 0, duration: 0.45, stagger: 0.08, ease: "power2.out" }, 1.35);

        revealSectionOnScroll(heroRoot, tl);
    })();

    // --- Scroll-reveal content + image gallery section: icon -> headline -> copy -> button -> images ---
    (function initGallerySection() {
        const sections = document.querySelectorAll('[data-animation-trigger="gallery"]');
        sections.forEach((sectionRoot) => {
            const icon = sectionRoot.querySelector(".heading_icon");
            const copy = sectionRoot.querySelector(".u-text.u-rich-text");
            const callout = sectionRoot.querySelector(".services_who_content .card_quote_wrap");
            const buttons = sectionRoot.querySelectorAll(".u-button-wrapper .button_main_wrap");
            const largeImage = sectionRoot.querySelector(".services_who_visual_wrap.is-large");
            const smallImage = sectionRoot.querySelector(".services_who_visual_wrap.is-small");
            const largeImg = largeImage && largeImage.querySelector("img");
            const smallImg = smallImage && smallImage.querySelector("img");
            const words = splitHeadingIntoWords(sectionRoot, ".heading_wrap .u-heading");

            const tl = gsap.timeline({ paused: true });

            tl.set(sectionRoot, { visibility: "visible" }, 0)
                .set(icon, { autoAlpha: 0, scaleY: 0, transformOrigin: "top center" }, 0)
                .set(words, { yPercent: 115, rotate: 3 }, 0)
                .set(copy, { opacity: 0, y: 14 }, 0)
                .set(callout, { opacity: 0, y: 14 }, 0)
                .set(buttons, { opacity: 0, y: 10 }, 0)
                // Each wrap's own box clips the reveal; the wipe direction differs per
                // image so the two frames don't feel like one mechanical repeat.
                // "round 1rem" keeps the wrap's own corner radius intact mid-wipe
                // instead of squaring it off while the clip shape animates.
                .set(largeImage, { clipPath: roundedClip("0px 100% 0px 0px", 1, 0.625) }, 0)
                .set(smallImage, { clipPath: roundedClip("0px 0px 0px 100%", 1, 0.625) }, 0)
                // Counter-scale + shift the photo itself against the wipe so the
                // image reads as uncovered rather than just a box growing open.
                .set(largeImg, { scale: 1.15, xPercent: 6 }, 0)
                .set(smallImg, { scale: 1.15, xPercent: -6 }, 0)
                // The spine icon draws open first, in place of the eyebrow tag used elsewhere.
                .to(icon, { autoAlpha: 1, scaleY: 1, duration: 0.6, ease: "power3.out" }, 0)
                // Headline rises word by word out of its mask, slight tilt settling to level.
                .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0.2)
                // Paragraph settles in slower and plainer — it's secondary, not a feature.
                .to(copy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 0.6)
                // The callout box lands after the paragraph, quiet and without anticipation.
                .to(callout, { opacity: 1, y: 0, duration: 0.55, ease: "power2.out" }, 0.78)
                // Button lands with a touch of anticipation, no cartoon bounce.
                .to(buttons, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "back.out(1.4)" }, 0.95)
                // Large frame wipes open left-to-right; its photo settles back into place as the clip reveals it.
                // Paced to land alongside the text sequence instead of finishing early.
                .to(largeImage, { clipPath: roundedClip("0px 0% 0px 0px", 1, 0.625), duration: 1.1, ease: "power4.inOut" }, 0.2)
                .to(largeImg, { scale: 1, xPercent: 0, duration: 1.3, ease: "power3.out" }, 0.2)
                // Small frame wipes open right-to-left, offset later so the two don't land together.
                .to(smallImage, { clipPath: roundedClip("0px 0px 0px 0%", 1, 0.625), duration: 1, ease: "power4.inOut" }, 0.5)
                .to(smallImg, { scale: 1, xPercent: 0, duration: 1.2, ease: "power3.out" }, 0.5);

            revealSectionOnScroll(sectionRoot, tl);
        });
    })();

    // --- Scroll-reveal content + single image section: icon -> headline -> copy -> callout -> image ---
    (function initCausesSection() {
        const sections = document.querySelectorAll('[data-animation-trigger="causes"]');
        sections.forEach((sectionRoot) => {
            const icon = sectionRoot.querySelector(".heading_icon");
            const copy = sectionRoot.querySelector(".u-text.u-rich-text");
            const callout = sectionRoot.querySelector(".services_causes_content > div:last-child");
            const imageWrap = sectionRoot.querySelector(".services_causes_visual");
            const img = imageWrap && imageWrap.querySelector("img");
            const words = splitHeadingIntoWords(sectionRoot, ".heading_wrap .u-heading");

            const tl = gsap.timeline({ paused: true });

            tl.set(sectionRoot, { visibility: "visible" }, 0)
                .set(icon, { autoAlpha: 0, scaleY: 0, transformOrigin: "top center" }, 0)
                .set(words, { yPercent: 115, rotate: 3 }, 0)
                .set(copy, { opacity: 0, y: 14 }, 0)
                .set(callout, { opacity: 0, y: 14 }, 0)
                // "round 1rem" keeps the image wrap's own corner radius intact
                // mid-wipe instead of squaring it off while the clip animates.
                .set(imageWrap, { clipPath: roundedClip("0px 100% 0px 0px") }, 0)
                .set(img, { scale: 1.15, xPercent: 6 }, 0)
                // The spine icon draws open first, in place of the eyebrow tag used elsewhere.
                .to(icon, { autoAlpha: 1, scaleY: 1, duration: 0.6, ease: "power3.out" }, 0)
                // Headline rises word by word out of its mask, slight tilt settling to level.
                .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0.2)
                // Paragraph settles in slower and plainer — it's secondary, not a feature.
                .to(copy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 0.6)
                // The callout box lands after the paragraph, quiet and without anticipation.
                .to(callout, { opacity: 1, y: 0, duration: 0.55, ease: "power2.out" }, 0.78)
                // The image wipes open left-to-right; the photo settles back into place as the clip reveals it.
                // Paced to land alongside the text sequence instead of finishing early.
                .to(imageWrap, { clipPath: roundedClip("0px 0% 0px 0px"), duration: 1.2, ease: "power4.inOut" }, 0.2)
                .to(img, { scale: 1, xPercent: 0, duration: 1.4, ease: "power3.out" }, 0.2);

            revealSectionOnScroll(sectionRoot, tl);
        });
    })();

    // --- Scroll-reveal process tabs section: tag -> headline -> cards -> closing copy/button ---
    (function initProcessSection() {
        const sections = document.querySelectorAll('[data-animation-trigger="process"]');
        sections.forEach((sectionRoot) => {
            const tag = sectionRoot.querySelector(".tag_wrap");
            const tabsWrap = sectionRoot.querySelector(".process_tabs_wrap");
            const cards = sectionRoot.querySelectorAll(".process_tabs_card_wrap");
            // Animate the inner content block for the y-rise, never the card wrap
            // itself: a transform on .process_tabs_card_wrap makes it the CSS
            // containing block for its absolutely-positioned .process_tabs_card_image,
            // which is meant to position against .process_tabs_wrap instead — adding
            // any transform here (even an identity one left behind by GSAP) collapses
            // that image's width to 0 and hides it entirely.
            const cardContents = sectionRoot.querySelectorAll(".process_tabs_card_content");
            const closingCopy = sectionRoot.querySelector(".u-text.u-rich-text");
            const closingButtons = sectionRoot.querySelectorAll(".u-button-wrapper .button_main_wrap");
            const words = splitHeadingIntoWords(sectionRoot, ".services_process_contain .u-heading");

            const tl = gsap.timeline({ paused: true });

            tl.set(sectionRoot, { visibility: "visible" }, 0)
                .set(tag, { opacity: 0, x: -8 }, 0)
                .set(words, { yPercent: 115, rotate: 3 }, 0)
                // Opacity only here too — same containing-block trap as the
                // individual card wraps below: a transform on .process_tabs_wrap
                // would break the absolutely-positioned card images inside it.
                .set(tabsWrap, { opacity: 0 }, 0)
                .set(cards, { opacity: 0 }, 0)
                .set(cardContents, { y: 20 }, 0)
                .set(closingButtons, { opacity: 0, y: 10 }, 0)
                // Eyebrow tag leads, same as every other section's opener.
                .to(tag, { opacity: 1, x: 0, duration: 0.45, ease: "power2.out" }, 0)
                // Headline rises word by word out of its mask, slight tilt settling to level.
                .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0.15)
                // The whole tabs block fades in first, then the three cards rise
                // in sequence inside it — this stands in for the tab-cycle that
                // otherwise runs on this same card set above 53em. Opacity only
                // on both the outer wrap and each card wrap (see notes above);
                // the rise motion lives on the content block inside each card.
                .to(tabsWrap, { opacity: 1, duration: 0.7, ease: "power2.out" }, 0.45)
                .to(cards, { opacity: 1, duration: 0.55, stagger: 0.12, ease: "power3.out" }, 0.55)
                .to(cardContents, { y: 0, duration: 0.55, stagger: 0.12, ease: "power3.out" }, 0.55)
                // Button lands with a touch of anticipation, no cartoon bounce.
                .to(closingButtons, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "back.out(1.4)" }, 1.2);

            if (closingCopy) {
                tl.set(closingCopy, { opacity: 0, y: 14 }, 0)
                    // Closing paragraph settles in slower and plainer — secondary, not a feature.
                    .to(closingCopy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 1.05);
            }

            revealSectionOnScroll(sectionRoot, tl);
        });
    })();

    // --- Dark bg-image section: backdrop settle -> headline -> numbered steps -> closing copy ---
    (function initFirstVisitSection() {
        const sections = document.querySelectorAll('[data-animation-trigger="first-visit"]');
        sections.forEach((sectionRoot) => {
            const steps = sectionRoot.querySelectorAll(".steps_list_item");
            const closingCopy = sectionRoot.querySelector(".u-text.u-rich-text");
            // Pass the heading's own wrapper, not .how_content — that block also
            // contains the steps list's own h3 titles, and querySelector would grab
            // whichever h-tag comes first in the DOM, which is fragile here.
            const words = splitHeadingIntoWords(sectionRoot, ".how_content > .u-heading");

            const tl = gsap.timeline({ paused: true });

            // Reuses the hero's backdrop treatment: whichever bg image variant
            // is actually visible settles in from a slight zoom. This section's
            // bg image class is "how_bg_image", not the hero's default.
            animateHeroBackdrop(tl, sectionRoot, "how_bg_image");

            tl.set(sectionRoot, { visibility: "visible" }, 0)
                .set(words, { yPercent: 115, rotate: 3 }, 0)
                .set(steps, { opacity: 0, y: 16 }, 0)
                // Headline rises word by word out of its mask — no eyebrow tag in this layout.
                .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0.3)
                // The three numbered steps rise in sequence.
                .to(steps, { opacity: 1, y: 0, duration: 0.55, stagger: 0.12, ease: "power3.out" }, 0.7);

            // Not every usage of this layout has a trailing paragraph below
            // the steps (e.g. the homepage's how_wrap doesn't).
            if (closingCopy) {
                tl.set(closingCopy, { opacity: 0, y: 14 }, 0)
                    // Closing paragraph settles in slower and plainer — secondary, not a feature.
                    .to(closingCopy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 1.25);
            }

            revealSectionOnScroll(sectionRoot, tl);
        });
    })();

    // --- Icon/heading/copy/callout + timeline card list (causes-style content, no image wipe) ---
    (function initTimelineSection() {
        const sections = document.querySelectorAll('[data-animation-trigger="timeline"]');
        sections.forEach((sectionRoot) => {
            const icon = sectionRoot.querySelector(".heading_icon");
            const copy = sectionRoot.querySelector(".u-text.u-rich-text");
            const callout = sectionRoot.querySelector(".services_timeline_content > .card_quote_wrap");
            const listWrap = sectionRoot.querySelector(".services_timeline_list_list");
            const timelineCards = sectionRoot.querySelectorAll(".card_timeline_wrap");
            const words = splitHeadingIntoWords(sectionRoot, ".heading_wrap .u-heading");

            const tl = gsap.timeline({ paused: true });

            tl.set(sectionRoot, { visibility: "visible" }, 0)
                .set(icon, { autoAlpha: 0, scaleY: 0, transformOrigin: "top center" }, 0)
                .set(words, { yPercent: 115, rotate: 3 }, 0)
                .set(copy, { opacity: 0, y: 14 }, 0)
                // The "round" token is never part of a tweened clip-path:
                // GSAP's inset() interpolator was injecting a spurious
                // left-inset value whenever "round" rode along in the
                // animated property (a CSSPlugin quirk), dragging the card
                // sideways mid-wipe. So the wipe itself tweens a plain,
                // round-free inset(); the rounded corners are restored with
                // a plain .set() the instant the wipe finishes.
                .set(listWrap, { clipPath: () => roundedClipTimeline("0% 0% 100% 0%") }, 0)
                .set(timelineCards, { opacity: 0, y: 20 }, 0)
                // The spine icon draws open first, in place of the eyebrow tag used elsewhere.
                .to(icon, { autoAlpha: 1, scaleY: 1, duration: 0.6, ease: "power3.out" }, 0)
                // Headline rises word by word out of its mask, slight tilt settling to level.
                .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0.2)
                // Paragraph settles in slower and plainer — it's secondary, not a feature.
                .to(copy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 0.6)
                // The list wipes open top-to-bottom first, then the cards inside
                // it rise in sequence once the wipe has mostly cleared them.
                .to(listWrap, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.9, ease: "power4.inOut" }, 0.2)
                .set(listWrap, { clipPath: () => roundedClipTimeline("0% 0% 0% 0%") })
                .to(timelineCards, { opacity: 1, y: 0, duration: 0.55, stagger: 0.12, ease: "power3.out" }, 0.65);

            if (callout) {
                tl.set(callout, { opacity: 0, y: 14 }, 0)
                    // The callout box lands after the paragraph, quiet and without anticipation.
                    .to(callout, { opacity: 1, y: 0, duration: 0.55, ease: "power2.out" }, 0.78);
            }

            revealSectionOnScroll(sectionRoot, tl);
        });
    })();

    // --- Centered heading + review cards + closing button/badge ---
    (function initReviewSection() {
        const sections = document.querySelectorAll('[data-animation-trigger="review"]');
        sections.forEach((sectionRoot) => {
            const closingButtons = sectionRoot.querySelectorAll(".u-button-wrapper .button_main_wrap");
            const closingBadge = sectionRoot.querySelector(".reviews-badge_outer");
            const words = splitHeadingIntoWords(sectionRoot, ".reviews_contain .u-heading");

            const tl = gsap.timeline({ paused: true });

            tl.set(sectionRoot, { visibility: "visible" }, 0)
                .set(words, { yPercent: 115, rotate: 3 }, 0)
                .set(closingButtons, { opacity: 0, y: 10 }, 0)
                .set(closingBadge, { opacity: 0, y: 10 }, 0)
                // Headline rises word by word out of its mask — centered, no eyebrow tag here.
                .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0)
                // Button and trailing rating badge land last, button with a touch of anticipation.
                .to(closingButtons, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "back.out(1.4)" }, 0.85)
                .to(closingBadge, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, 1.0);

            revealSectionOnScroll(sectionRoot, tl);

            // The review cards are CMS-rendered (Webflow's .w-dyn-list). On some
            // loads they aren't in the DOM yet at DOMContentLoaded, so querying
            // them here can grab an empty list and silently wire nothing. Poll
            // briefly until they exist, then set up the batch reveal.
            let attempts = 0;
            const trySetupCards = () => {
                const reviewItems = [...sectionRoot.querySelectorAll(".reviews_list_item")];
                if (!reviewItems.length) {
                    attempts += 1;
                    if (attempts < 120) requestAnimationFrame(trySetupCards);
                    return;
                }

                const revealedCards = new WeakSet();
                let batchTriggers = [];

                const revealCards = (items, immediate) => {
                    const pending = items.filter((item) => !revealedCards.has(item));
                    if (!pending.length) return;
                    pending.forEach((item) => revealedCards.add(item));

                    if (immediate) {
                        gsap.set(pending, { opacity: 1, y: 0 });
                    } else {
                        gsap.to(pending, {
                            opacity: 1,
                            y: 0,
                            duration: 0.55,
                            stagger: 0.1,
                            ease: "power3.out",
                            overwrite: "auto"
                        });
                    }

                    if (batchTriggers.length && reviewItems.every((item) => revealedCards.has(item))) {
                        const triggersToKill = batchTriggers;
                        batchTriggers = [];
                        gsap.delayedCall(0, () => triggersToKill.forEach((st) => st.kill()));
                    }
                };

                const checkCards = () => {
                    const vh = window.innerHeight || document.documentElement.clientHeight;
                    const passed = [];
                    const visible = [];
                    for (let i = 0; i < reviewItems.length; i += 1) {
                        const item = reviewItems[i];
                        if (revealedCards.has(item)) continue;
                        const rect = item.getBoundingClientRect();
                        if (rect.bottom <= 0) {
                            passed.push(item);
                        } else if (rect.top <= vh * 0.85) {
                            visible.push(item);
                        }
                    }
                    if (passed.length) revealCards(passed, true);
                    if (visible.length) revealCards(visible, false);
                    return reviewItems.every((item) => revealedCards.has(item));
                };

                // Only hide cards that are not already scrolled past above the viewport.
                const cardsToWatch = [];
                reviewItems.forEach((item) => {
                    const rect = item.getBoundingClientRect();
                    if (rect.bottom <= 0) {
                        revealedCards.add(item);
                    } else {
                        cardsToWatch.push(item);
                    }
                });

                if (cardsToWatch.length) {
                    gsap.set(cardsToWatch, { opacity: 0, y: 20 });
                    // Omit `once: true` to avoid GSAP 3.15's recursive Te.refresh
                    // self-kill array mutation bug; revealCards deduplicates and
                    // cleans up triggers once all cards are shown.
                    batchTriggers = ScrollTrigger.batch(cardsToWatch, {
                        start: "top 85%",
                        onEnter: (batch) => {
                            const passed = [];
                            const visible = [];
                            batch.forEach((el) => {
                                if (el.getBoundingClientRect().bottom <= 0) passed.push(el);
                                else visible.push(el);
                            });
                            if (passed.length) revealCards(passed, true);
                            if (visible.length) revealCards(visible, false);
                        },
                        onEnterBack: (batch) => revealCards(batch, false)
                    });
                    pendingReveals.push(checkCards);
                    checkCards();
                }

                // If cards arrived asynchronously after initial setup, refresh
                // downstream triggers against the final grid height.
                if (attempts > 0) scheduleRefresh();
            };
            trySetupCards();
        });
    })();

    // --- Dark card group (cost cards): header then cards staggered ---
    (function initCardGroupSection() {
        const sections = document.querySelectorAll('[data-animation-trigger="card-group"]');
        sections.forEach((sectionRoot) => {
            const headerWords = splitHeadingIntoWords(sectionRoot, ".card-group_header .u-heading");
            const headerCopy = sectionRoot.querySelector(".card-group_header .u-text.u-rich-text");
            const cards = sectionRoot.querySelectorAll(".card_primary_wrap");

            const tl = gsap.timeline({ paused: true });

            tl.set(sectionRoot, { visibility: "visible" }, 0)
                .set(headerWords, { yPercent: 115, rotate: 3 }, 0)
                .set(headerCopy, { opacity: 0, y: 14 }, 0)
                .set(cards, { opacity: 0, y: 20 }, 0)
                // Headline rises word by word out of its mask.
                .to(headerWords, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0)
                // Paragraph settles in slower and plainer — it's secondary, not a feature.
                .to(headerCopy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 0.4)
                // The pricing/cost cards rise in sequence, slower and more spaced
                // out than the usual card stagger so each one reads individually.
                .to(cards, { opacity: 1, y: 0, duration: 0.85, stagger: 0.2, ease: "power3.out" }, 0.6);

            revealSectionOnScroll(sectionRoot, tl);
        });
    })();

    // --- Final CTA: hero-pattern backdrop -> headline -> copy -> buttons -> closing address line ---
    (function initCtaSection() {
        const sections = document.querySelectorAll('[data-animation-trigger="cta"]');
        sections.forEach((sectionRoot) => {
            const copy = sectionRoot.querySelector(".u-text.u-rich-text.u-color-faded");
            const buttons = sectionRoot.querySelectorAll(".u-button-wrapper .button_main_wrap");
            const closingLine = sectionRoot.querySelector(".cta_contain > .u-text.u-rich-text");
            const words = splitHeadingIntoWords(sectionRoot, ".cta_contain .u-heading");

            const tl = gsap.timeline({ paused: true });

            // Same bg-image treatment as the hero, scoped to this section's own
            // mobile/desktop image pair class.
            animateHeroBackdrop(tl, sectionRoot, "cta_bg_image");

            tl.set(sectionRoot, { visibility: "visible" }, 0)
                .set(words, { yPercent: 115, rotate: 3 }, 0)
                .set(copy, { opacity: 0, y: 14 }, 0)
                .set(buttons, { opacity: 0, y: 10 }, 0)
                .set(closingLine, { opacity: 0, y: 10 }, 0)
                // Headline rises word by word out of its mask — no eyebrow tag in this layout.
                .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0.3)
                // Paragraph settles in slower and plainer — it's secondary, not a feature.
                .to(copy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 0.7)
                // Buttons land with a touch of anticipation, no cartoon bounce.
                .to(buttons, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "back.out(1.4)" }, 0.85)
                // The closing address/hours line settles in last, quiet.
                .to(closingLine, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, 1.0);

            revealSectionOnScroll(sectionRoot, tl);
        });
    })();

    // --- Cost section: heading -> covered-items list -> image -> closing text -> logo marquee -> buttons ---
    (function initCostSection() {
        const sections = document.querySelectorAll('[data-animation-trigger="cost"]');
        sections.forEach((sectionRoot) => {
            const dividers = sectionRoot.querySelectorAll(".services_cost_divider");
            const listItems = sectionRoot.querySelectorAll(".services_cost_list_item");
            const closingText = sectionRoot.querySelector(".services_cost_text");
            const imageWrap = sectionRoot.querySelector(".services_cost_visual_wrap");
            const img = imageWrap && imageWrap.querySelector("img");
            const belowText = sectionRoot.querySelector(".u-order-last-medium .u-text.u-rich-text");
            const logoWrap = sectionRoot.querySelector(".insurance_logo_wrap");
            const buttons = sectionRoot.querySelectorAll(".u-button-wrapper .button_main_wrap");
            const words = splitHeadingIntoWords(sectionRoot, ".u-container > .u-content-wrapper .u-heading");
            // "YOUR FIRST VISIT" (a plain styled div) and "This Covers" (an
            // unwrapped h3) above the covered-items list.
            const visitWords = splitHeadingIntoWords(sectionRoot, ".services_cost_content > .u-text-style-h3");
            const coversWords = splitHeadingIntoWords(sectionRoot, ".services_cost_content > h3.u-text-style-large");

            const tl = gsap.timeline({ paused: true });

            tl.set(sectionRoot, { visibility: "visible" }, 0)
                .set(words, { yPercent: 115, rotate: 3 }, 0)
                .set(listItems, { opacity: 0, y: 16 }, 0)
                .set(closingText, { opacity: 0, y: 10 }, 0)
                // This wrap has no border-radius (checked via getComputedStyle,
                // unlike the gallery/causes image wraps) — plain square clip.
                .set(imageWrap, { clipPath: "inset(0px 100% 0px 0px)" }, 0)
                .set(img, { scale: 1.15, xPercent: 6 }, 0)
                .set(logoWrap, { opacity: 0, y: 14 }, 0)
                .set(buttons, { opacity: 0, y: 10 }, 0)
                // Headline rises word by word out of its mask.
                .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0)
                // The covered-items list rises in sequence.
                .to(listItems, { opacity: 1, y: 0, duration: 0.5, stagger: 0.1, ease: "power3.out" }, 0.45)
                // Closing cost line settles in quiet.
                .to(closingText, { opacity: 1, y: 0, duration: 0.5, ease: "power1.out" }, 1.05)
                // The image wipes open left-to-right alongside the text column's reveal.
                .to(imageWrap, { clipPath: "inset(0px 0% 0px 0px)", duration: 1.1, ease: "power4.inOut" }, 0.2)
                .to(img, { scale: 1, xPercent: 0, duration: 1.3, ease: "power3.out" }, 0.2)
                // The insurance logo marquee, then buttons.
                .to(logoWrap, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, 1.4)
                .to(buttons, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "back.out(1.4)" }, 1.6);

            if (visitWords.length) {
                tl.set(visitWords, { yPercent: 115, rotate: 3 }, 0)
                    // "Your First Visit" rises right after — small word-mask reveal.
                    .to(visitWords, { yPercent: 0, rotate: 0, duration: 0.7, stagger: 0.03, ease: "power4.out" }, 0.15);
            }
            if (coversWords.length) {
                tl.set(coversWords, { yPercent: 115, rotate: 3 }, 0)
                    .to(coversWords, { yPercent: 0, rotate: 0, duration: 0.7, stagger: 0.03, ease: "power4.out" }, 0.35);
            }
            if (dividers.length) {
                tl.set(dividers, { scaleX: 0, transformOrigin: "left center" }, 0);
                // The top divider draws open first, framing "Your First Visit" / "This Covers".
                if (dividers[0]) tl.to(dividers[0], { scaleX: 1, duration: 0.5, ease: "power3.inOut" }, 0.3);
                if (dividers[1]) tl.to(dividers[1], { scaleX: 1, duration: 0.5, ease: "power3.inOut" }, 0.9);
            }
            if (belowText) {
                tl.set(belowText, { opacity: 0, y: 14 }, 0)
                    .to(belowText, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 1.2);
            }

            revealSectionOnScroll(sectionRoot, tl);
        });
    })();

    // --- FAQ section: heading -> accordion items staggered ---
    (function initFaqSection() {
        const sections = document.querySelectorAll('[data-animation-trigger="faqs"]');
        sections.forEach((sectionRoot) => {
            const words = splitHeadingIntoWords(sectionRoot, ".faq_contain > .u-content-wrapper .u-heading");

            const tl = gsap.timeline({ paused: true });

            tl.set(sectionRoot, { visibility: "visible" }, 0)
                .set(words, { yPercent: 115, rotate: 3 }, 0)
                // Headline rises word by word out of its mask.
                .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0);

            const wireItems = (items) => {
                tl.set(items, { opacity: 0, y: 16 }, 0)
                    // Stagger items right behind the heading so no cards sit
                    // invisible inside the lower viewport when the section lands.
                    .to(items, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "power3.out" }, 0.25);
            };

            const initialItems = sectionRoot.querySelectorAll(".accordion_item");
            if (initialItems.length) {
                wireItems(initialItems);
                revealSectionOnScroll(sectionRoot, tl);
                return;
            }

            revealSectionOnScroll(sectionRoot, tl);

            // Fallback if CMS accordion items hydrate after DOMContentLoaded.
            let attempts = 0;
            const trySetupAccordion = () => {
                const items = sectionRoot.querySelectorAll(".accordion_item");
                if (!items.length) {
                    attempts += 1;
                    if (attempts < 120) requestAnimationFrame(trySetupAccordion);
                    return;
                }

                if (tl.progress() === 1) {
                    scheduleRefresh();
                    return;
                }

                if (tl.isActive()) {
                    gsap.fromTo(
                        items,
                        { opacity: 0, y: 16 },
                        { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "power3.out" }
                    );
                } else {
                    wireItems(items);
                }
                scheduleRefresh();
            };
            requestAnimationFrame(trySetupAccordion);
        });
    })();

    // --- Who-single (Auto Accident variant): icon -> headline -> copy -> callout -> button -> image ---
    (function initWhoSingleSection() {
        const sections = document.querySelectorAll('[data-animation-trigger="who-single"]');
        sections.forEach((sectionRoot) => {
            const icon = sectionRoot.querySelector(".heading_icon");
            const copy = sectionRoot.querySelector(".services_who_content .u-text.u-rich-text");
            const callout = sectionRoot.querySelector(".services_who_content .card_quote_wrap");
            const buttons = sectionRoot.querySelectorAll(".u-button-wrapper .button_main_wrap");
            const imageWrap = sectionRoot.querySelector(".services_who_visual_wrap");
            const img = imageWrap && imageWrap.querySelector("img");
            const words = splitHeadingIntoWords(sectionRoot, ".heading_wrap .u-heading");

            const tl = gsap.timeline({ paused: true });

            tl.set(sectionRoot, { visibility: "visible" }, 0)
                .set(icon, { autoAlpha: 0, scaleY: 0, transformOrigin: "top center" }, 0)
                .set(words, { yPercent: 115, rotate: 3 }, 0)
                .set(copy, { opacity: 0, y: 14 }, 0)
                .set(callout, { opacity: 0, y: 14 }, 0)
                .set(buttons, { opacity: 0, y: 10 }, 0)
                // "round 1rem" keeps the image wrap's own corner radius intact
                // mid-wipe instead of squaring it off while the clip animates.
                .set(imageWrap, { clipPath: roundedClip("0px 100% 0px 0px") }, 0)
                .set(img, { scale: 1.15, xPercent: 6 }, 0)
                // The spine icon draws open first, in place of the eyebrow tag used elsewhere.
                .to(icon, { autoAlpha: 1, scaleY: 1, duration: 0.6, ease: "power3.out" }, 0)
                // Headline rises word by word out of its mask, slight tilt settling to level.
                .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0.2)
                // Paragraph settles in slower and plainer — it's secondary, not a feature.
                .to(copy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 0.6)
                // The callout box lands after the paragraph, quiet and without anticipation.
                .to(callout, { opacity: 1, y: 0, duration: 0.55, ease: "power2.out" }, 0.78)
                // Button lands with a touch of anticipation, no cartoon bounce.
                .to(buttons, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "back.out(1.4)" }, 0.95)
                // The image wipes open left-to-right alongside the text column's reveal.
                .to(imageWrap, { clipPath: roundedClip("0px 0% 0px 0px"), duration: 1.2, ease: "power4.inOut" }, 0.2)
                .to(img, { scale: 1, xPercent: 0, duration: 1.4, ease: "power3.out" }, 0.2);

            revealSectionOnScroll(sectionRoot, tl);
        });
    })();

    // --- Split section (image left, icon/heading/copy/callout right — causes mirrored) ---
    (function initSplitSection() {
        const sections = document.querySelectorAll('[data-animation-trigger="split"]');
        sections.forEach((sectionRoot) => {
            const icon = sectionRoot.querySelector(".heading_icon");
            const copy = sectionRoot.querySelector(".split_content .u-text.u-rich-text");
            const callout = sectionRoot.querySelector(".split_content .card_quote_wrap");
            const imageWrap = sectionRoot.querySelector(".split_visual_wrap .u-image-wrapper");
            const img = imageWrap && imageWrap.querySelector("img");
            const words = splitHeadingIntoWords(sectionRoot, ".split_content .heading_wrap .u-heading");

            // This section's "Position Desktop" setting can put the image on
            // either side, so detect which one is actually true at runtime
            // (rect comparison, not a class/order check — Webflow can flip
            // this via DOM order, grid placement, or flex order depending on
            // the breakpoint) rather than assuming a fixed layout. The wipe
            // should always uncover from the content's side toward the image's
            // own outer edge, never a mirrored copy of the causes/gallery wipe.
            const imageOnLeft =
                sectionRoot.querySelector(".split_visual_wrap").getBoundingClientRect().left <
                sectionRoot.querySelector(".split_content").getBoundingClientRect().left;
            const closedClip = roundedClip(imageOnLeft ? "0px 0px 0px 100%" : "0px 100% 0px 0px");
            const openClip = roundedClip(imageOnLeft ? "0px 0px 0px 0%" : "0px 0% 0px 0px");
            const imgStartXPercent = imageOnLeft ? -6 : 6;

            const tl = gsap.timeline({ paused: true });

            tl.set(sectionRoot, { visibility: "visible" }, 0)
                .set(icon, { autoAlpha: 0, scaleY: 0, transformOrigin: "top center" }, 0)
                .set(words, { yPercent: 115, rotate: 3 }, 0)
                .set(copy, { opacity: 0, y: 14 }, 0)
                .set(imageWrap, { clipPath: closedClip }, 0)
                .set(img, { scale: 1.15, xPercent: imgStartXPercent }, 0)
                .to(icon, { autoAlpha: 1, scaleY: 1, duration: 0.6, ease: "power3.out" }, 0)
                .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0.2)
                .to(copy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 0.6)
                .to(imageWrap, { clipPath: openClip, duration: 1.2, ease: "power4.inOut" }, 0.2)
                .to(img, { scale: 1, xPercent: 0, duration: 1.4, ease: "power3.out" }, 0.2);

            if (callout) {
                tl.set(callout, { opacity: 0, y: 14 }, 0)
                    .to(callout, { opacity: 1, y: 0, duration: 0.55, ease: "power2.out" }, 0.78);
            }

            revealSectionOnScroll(sectionRoot, tl);
        });
    })();

    // --- Intro (conditions video teaser): visual wipe + headline/copy ---
    (function initIntroSection() {
        const sectionRoot = document.querySelector('[data-animation-trigger="intro"]');
        if (!sectionRoot) return;

        const visual = sectionRoot.querySelector(".intro_visual_wrap");
        const img = visual && visual.querySelector("img");
        const tag = sectionRoot.querySelector(".tag_wrap");
        const words = splitHeadingIntoWords(sectionRoot, ".u-heading");
        const listItems = sectionRoot.querySelectorAll(".intro_list_item");
        const button = sectionRoot.querySelector(".button_main_wrap");

        const tl = gsap.timeline({ paused: true });

        tl.set(sectionRoot, { visibility: "visible" }, 0)
            .set(visual, { clipPath: roundedClip("0px 0px 0px 100%") }, 0)
            .set(img, { scale: 1.15, xPercent: -6 }, 0)
            .set(tag, { opacity: 0, y: 10 }, 0)
            .set(words, { yPercent: 115, rotate: 3 }, 0)
            .set(listItems, { opacity: 0, y: 14 }, 0)
            .set(button, { opacity: 0, y: 10 }, 0)
            // Video thumbnail wipes open right-to-left, since it's the left
            // column here (mirror of the gallery/causes wipe direction).
            .to(visual, { clipPath: roundedClip("0px 0px 0px 0%"), duration: 1.2, ease: "power4.inOut" }, 0)
            .to(img, { scale: 1, xPercent: 0, duration: 1.4, ease: "power3.out" }, 0)
            .to(tag, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, 0)
            .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0.2)
            .to(listItems, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "power3.out" }, 0.6)
            .to(button, { opacity: 1, y: 0, duration: 0.5, ease: "back.out(1.4)" }, 0.9);

        // Sits directly below a full-viewport hero — trigger as soon as it
        // starts entering the viewport (not the usual "top 80%") so it never
        // leaves a blank gap while the hero is still fully in view.
        revealSectionOnScroll(sectionRoot, tl, "top 100%");
    })();

    // --- Conditions grid: headline/copy -> symptom tiles staggered in a wave ---
    (function initConditionsSection() {
        const sectionRoot = document.querySelector('[data-animation-trigger="conditions"]');
        if (!sectionRoot) return;

        const words = splitHeadingIntoWords(sectionRoot, ".u-heading");
        const copy = sectionRoot.querySelector(".u-text.u-rich-text");
        const items = sectionRoot.querySelectorAll(".conditions_list_item");

        const tl = gsap.timeline({ paused: true });

        tl.set(sectionRoot, { visibility: "visible" }, 0)
            .set(words, { yPercent: 115, rotate: 3 }, 0)
            .set(copy, { opacity: 0, y: 14 }, 0)
            .set(items, { opacity: 0, y: 14 }, 0)
            .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0)
            .to(copy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 0.35)
            // 29 tiles — a tight stagger (0.025s) keeps the wave fast and
            // cheap rather than visibly crawling across a grid this size.
            .to(items, { opacity: 1, y: 0, duration: 0.45, stagger: 0.025, ease: "power3.out" }, 0.55);

        revealSectionOnScroll(sectionRoot, tl);
    })();

    // --- Team/bio section: slider visual settle -> headline/copy -> button ---
    (function initTeamSection() {
        const sectionRoot = document.querySelector('[data-animation-trigger="team"]');
        if (!sectionRoot) return;

        const sliderWrap = sectionRoot.querySelector(".team_slider_element");
        const sliderImg = sectionRoot.querySelector(".team_slider_item img");
        const words = splitHeadingIntoWords(sectionRoot, ".team_visual_content .u-heading");
        const copy = sectionRoot.querySelector(".team_visual_content .u-text.u-rich-text");
        const bioButton = sectionRoot.querySelector(".team_visual_content .button_main_wrap");

        // Bottom block ("The people who make the visit easy") is a separate
        // heading/card grid below the bio slider, not part of it — needs its
        // own word-split and its own reveal beats.
        const bottomWords = splitHeadingIntoWords(sectionRoot, ".team_bottom .u-heading");
        const cards = sectionRoot.querySelectorAll(".team_card_wrap");
        const teamButton = sectionRoot.querySelector(".team_bottom > .button_main_wrap");

        const tl = gsap.timeline({ paused: true });

        tl.set(sectionRoot, { visibility: "visible" }, 0)
            .set(sliderWrap, { opacity: 0 }, 0)
            .set(sliderImg, { scale: 1.1 }, 0)
            .set(words, { yPercent: 115, rotate: 3 }, 0)
            .set(copy, { opacity: 0, y: 14 }, 0)
            .set(bioButton, { opacity: 0, y: 10 }, 0)
            .set(bottomWords, { yPercent: 115, rotate: 3 }, 0)
            .set(cards, { opacity: 0, y: 14 }, 0)
            .set(teamButton, { opacity: 0, y: 10 }, 0)
            // Fade only on the slider wrap (its own swiper library manages
            // transforms on slides internally — animating anything but
            // opacity/scale on the outer wrap risks fighting swiper's layout).
            .to(sliderWrap, { opacity: 1, duration: 0.7, ease: "power2.out" }, 0)
            .to(sliderImg, { scale: 1, duration: 1.3, ease: "power3.out" }, 0)
            .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0.25)
            .to(copy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 0.65)
            .to(bioButton, { opacity: 1, y: 0, duration: 0.5, ease: "back.out(1.4)" }, 0.95)
            .to(bottomWords, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 1.1)
            .to(cards, { opacity: 1, y: 0, duration: 0.5, stagger: 0.1, ease: "power3.out" }, 1.45)
            .to(teamButton, { opacity: 1, y: 0, duration: 0.5, ease: "back.out(1.4)" }, 1.75);

        revealSectionOnScroll(sectionRoot, tl);
    })();

    // --- New-patient first-visit grid: headline/copy -> icon items staggered ---
    (function initNewPatientSection() {
        const sectionRoot = document.querySelector('[data-animation-trigger="new-patient"]');
        if (!sectionRoot) return;

        const words = splitHeadingIntoWords(sectionRoot, ".u-heading");
        const copy = sectionRoot.querySelector(".u-text.u-rich-text");
        const items = sectionRoot.querySelectorAll(".new_grid_item");

        const tl = gsap.timeline({ paused: true });

        tl.set(sectionRoot, { visibility: "visible" }, 0)
            .set(words, { yPercent: 115, rotate: 3 }, 0)
            .set(copy, { opacity: 0, y: 14 }, 0)
            .set(items, { opacity: 0, y: 16 }, 0)
            .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0)
            .to(copy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 0.35)
            .to(items, { opacity: 1, y: 0, duration: 0.55, stagger: 0.1, ease: "power3.out" }, 0.55);

        revealSectionOnScroll(sectionRoot, tl);
    })();

    // --- Auto accident callout card: gradient card settles -> headline/copy -> button ---
    (function initAccidentSection() {
        const sectionRoot = document.querySelector('[data-animation-trigger="accident"]');
        if (!sectionRoot) return;

        const card = sectionRoot.querySelector(".accident_layout");
        const visual = sectionRoot.querySelector(".accident_visual_wrap");
        const img = visual && visual.querySelector("img");
        const words = splitHeadingIntoWords(sectionRoot, ".u-heading");
        const copy = sectionRoot.querySelector(".u-text.u-rich-text");
        const buttons = sectionRoot.querySelectorAll(".button_main_wrap");

        const tl = gsap.timeline({ paused: true });

        tl.set(sectionRoot, { visibility: "visible" }, 0)
            .set(card, { opacity: 0, y: 20 }, 0)
            .set(visual, { clipPath: roundedClip("0px 100% 0px 0px") }, 0)
            .set(img, { scale: 1.15, xPercent: 6 }, 0)
            .set(words, { yPercent: 115, rotate: 3 }, 0)
            .set(copy, { opacity: 0, y: 14 }, 0)
            .set(buttons, { opacity: 0, y: 10 }, 0)
            // Card settles in as one plate first — it's a single contained
            // unit on the gradient background, not a text-then-image reveal.
            .to(card, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, 0)
            .to(visual, { clipPath: roundedClip("0px 0% 0px 0px"), duration: 1.1, ease: "power4.inOut" }, 0.1)
            .to(img, { scale: 1, xPercent: 0, duration: 1.3, ease: "power3.out" }, 0.1)
            .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0.3)
            .to(copy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 0.65)
            .to(buttons, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "back.out(1.4)" }, 0.9);

        revealSectionOnScroll(sectionRoot, tl);
    })();

    // --- Insurance section: icon/title/copy -> logo wall staggered in a wave ---
    (function initInsuranceSection() {
        const sectionRoot = document.querySelector('[data-animation-trigger="insurance"]');
        if (!sectionRoot) return;

        const icon = sectionRoot.querySelector(".icon_wrap");
        const title = sectionRoot.querySelector(".insuranse_title");
        const copy = sectionRoot.querySelector(".u-text.u-rich-text");
        const logos = sectionRoot.querySelectorAll(".insurance_logo_item");

        const tl = gsap.timeline({ paused: true });

        tl.set(sectionRoot, { visibility: "visible" }, 0)
            .set(icon, { opacity: 0, y: 10 }, 0)
            .set(title, { opacity: 0, y: 14 }, 0)
            .set(copy, { opacity: 0, y: 14 }, 0)
            .set(logos, { opacity: 0, y: 12 }, 0)
            .to(icon, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }, 0)
            .to(title, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, 0.15)
            .to(copy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 0.4)
            // A dozen-plus logos — tight stagger keeps the wave fast and cheap.
            .to(logos, { opacity: 1, y: 0, duration: 0.4, stagger: 0.03, ease: "power3.out" }, 0.65);

        revealSectionOnScroll(sectionRoot, tl);
    })();

    // --- Contact/map section: icon -> headline/copy -> map frame -> contact rows ---
    (function initContactSection() {
        const sectionRoot = document.querySelector('[data-animation-trigger="contact"]');
        if (!sectionRoot) return;

        const icon = sectionRoot.querySelector(".heading_icon");
        const words = splitHeadingIntoWords(sectionRoot, ".heading_wrap .u-heading");
        const copy = sectionRoot.querySelector(".u-text.u-rich-text");
        const mapWrap = sectionRoot.querySelector(".contact_map_wrap");
        const rows = sectionRoot.querySelectorAll(".contact_map_content > div, .contact_map_content > a");

        const tl = gsap.timeline({ paused: true });

        tl.set(sectionRoot, { visibility: "visible" }, 0)
            .set(icon, { autoAlpha: 0, scaleY: 0, transformOrigin: "top center" }, 0)
            .set(words, { yPercent: 115, rotate: 3 }, 0)
            .set(copy, { opacity: 0, y: 14 }, 0)
            .set(mapWrap, { opacity: 0, y: 16 }, 0)
            // The spine icon draws open first, same as every other section using it.
            .to(icon, { autoAlpha: 1, scaleY: 1, duration: 0.6, ease: "power3.out" }, 0)
            .to(words, { yPercent: 0, rotate: 0, duration: 0.9, stagger: 0.04, ease: "power4.out" }, 0.2)
            .to(copy, { opacity: 1, y: 0, duration: 0.6, ease: "power1.out" }, 0.6)
            // Map settles in as a plain fade — a wipe/clip reveal on an
            // embedded Google Map risks clipping its own internal tiles mid-load.
            .to(mapWrap, { opacity: 1, y: 0, duration: 0.7, ease: "power2.out" }, 0.4);

        if (rows.length) {
            tl.set(rows, { opacity: 0, y: 10 }, 0)
                .to(rows, { opacity: 1, y: 0, duration: 0.45, stagger: 0.08, ease: "power2.out" }, 0.85);
        }

        revealSectionOnScroll(sectionRoot, tl);
    })();

    // --- Footer: about block -> nav columns (staggered) -> wordmark settles last ---
    (function initFooterSection() {
        const sectionRoot = document.querySelector(".footer_wrap");
        if (!sectionRoot) return;

        const about = sectionRoot.querySelector(".footer_about_wrap");
        // Each nav column (Navigation / Conditions / Locations / Working Hours)
        // plus the contact/hours block sits as a direct child of footer_row
        // alongside .footer_about_wrap — grab every sibling column generically
        // instead of hardcoding four separate selectors that break if Webflow
        // reorders or renames one of them.
        const columns = [...sectionRoot.querySelectorAll(".footer_row > *")].filter((el) => el !== about);
        const wordmark = sectionRoot.querySelector(".footer_logo, .footer_brand, [class*='logo']");

        const tl = gsap.timeline({ paused: true });

        tl.set(sectionRoot, { visibility: "visible" }, 0)
            .set(about, { opacity: 0, y: 20 }, 0)
            .set(columns, { opacity: 0, y: 20 }, 0)
            // About block and nav columns rise together, offset slightly so it
            // reads as one wave sweeping left to right across the row.
            .to(about, { opacity: 1, y: 0, duration: 0.6, ease: "power2.out" }, 0)
            .to(columns, { opacity: 1, y: 0, duration: 0.6, stagger: 0.08, ease: "power2.out" }, 0.1);

        if (wordmark) {
            tl.set(wordmark, { opacity: 0, y: 12 }, 0)
                // The big wordmark gets its own quiet moment after the columns
                // land, instead of appearing flat with everything else.
                .to(wordmark, { opacity: 1, y: 0, duration: 0.7, ease: "power2.out" }, 0.5);
        }

        revealSectionOnScroll(sectionRoot, tl, "top 90%");
    })();

    // --- Report-of-findings graph (new patient page embed): the long decline draws, the fall, then the climb ---
    // Markup lives in an HTML embed (.rof-graph). It is fully drawn and visible
    // with no JS, so this only ever animates on top of a complete chart.
    (function initReportGraph() {
        const charts = document.querySelectorAll(".rof-graph");
        if (!charts.length) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        // Fraction (0-1) along a path of the point nearest to x,y.
        function fractionNear(path, x, y) {
            const total = path.getTotalLength();
            let best = 0;
            let bestDist = Infinity;
            for (let i = 0; i <= 400; i += 1) {
                const p = path.getPointAtLength((total * i) / 400);
                const dist = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = i / 400;
                }
            }
            return best;
        }

        // Fraction (0-1) along a path where it first reaches y.
        function fractionAtY(path, y) {
            const total = path.getTotalLength();
            for (let i = 0; i <= 400; i += 1) {
                if (path.getPointAtLength((total * i) / 400).y >= y) return i / 400;
            }
            return 1;
        }

        charts.forEach((root) => {
            // The embed holds a desktop and a mobile <svg>; the container query
            // hides one, so only drive the one that is actually showing.
            const svg = [...root.querySelectorAll(".rof-graph__svg")].find(
                (el) => getComputedStyle(el).display !== "none"
            );
            if (!svg) return;

            const part = (name) => svg.querySelector(".rof-graph__" + name);
            const label = (key) => root.querySelector('[data-rof="' + key + '"]');
            const decline = part("decline");
            const climb = part("climb");
            const then = part("then");
            const arrow = part("arrowhead");
            const fallDot = part("dot--fall");
            const findDot = part("dot--find");
            const zone = part("zone");
            const labels = root.querySelectorAll(".rof-graph__label");
            if (!decline || !climb || !then || !arrow || !fallDot || !findDot || !zone) return;

            const length = (path) => path.getTotalLength();
            // Where the hollow dot ("fell off the horse") and the symptom-zone line
            // sit along the decline path, so the timing follows the drawing.
            const fall = decline.dataset.fall.split(",").map(Number);
            const fractionFall = fractionNear(decline, fall[0], fall[1]);
            const fractionZone = fractionAtY(decline, Number(decline.dataset.zoneY));

            // Lines start undrawn and hidden: a round cap on a zero-length dash
            // would otherwise leave a dot at the path's origin.
            [decline, climb, then].forEach((path) => {
                gsap.set(path, { strokeDasharray: length(path), strokeDashoffset: length(path), autoAlpha: 0 });
            });
            gsap.set([fallDot, findDot], { scale: 0, transformOrigin: "50% 50%" });
            gsap.set(arrow, { autoAlpha: 0, x: -6 });
            gsap.set(labels, { autoAlpha: 0, y: 8 });

            const show = { autoAlpha: 1, y: 0, duration: 0.5, ease: "power2.out" };
            const pop = { scale: 1, duration: 0.35, ease: "back.out(2.5)" };
            const DRIFT = 1.5; // the slow years
            const DROP = 0.75; // the fall
            const tDrop = DRIFT + 0.45; // a beat after "fell off the horse"
            // The drop eases with power2.in (progress = t squared), so invert that
            // to find when the line crosses into the symptom zone.
            const tZone = tDrop + DROP * Math.sqrt((fractionZone - fractionFall) / (1 - fractionFall));
            const tBottom = tDrop + DROP;
            const tClimb = tBottom + 0.5;
            const CLIMB = 1.2;

            const tl = gsap.timeline({ paused: true });

            tl.set(decline, { autoAlpha: 1 }, 0)
                .to(label("optimal"), show, 0)
                .to(decline, { strokeDashoffset: length(decline) * (1 - fractionFall), duration: DRIFT, ease: "none" }, 0)
                .to(label("years"), show, DRIFT * 0.4)
                .to(fallDot, pop, DRIFT - 0.05)
                .to(label("moment"), show, DRIFT + 0.05)
                .to(decline, { strokeDashoffset: 0, duration: DROP, ease: "power2.in" }, tDrop)
                // The zone flashes as the line crosses into it, then settles back.
                .to(zone, { fillOpacity: 0.34, duration: 0.25, ease: "power1.out", yoyo: true, repeat: 1 }, tZone)
                .to(label("symptom"), show, tZone)
                .to(findDot, pop, tBottom - 0.05)
                .to(label("find"), show, tBottom + 0.05)
                .set(climb, { autoAlpha: 1 }, tClimb)
                .to(climb, { strokeDashoffset: 0, duration: CLIMB, ease: "power2.in" }, tClimb)
                .to(label("plan"), show, tClimb + CLIMB * 0.45)
                .set(then, { autoAlpha: 1 }, tClimb + CLIMB)
                .to(then, { strokeDashoffset: 0, duration: 0.5, ease: "power2.out" }, tClimb + CLIMB)
                .to(arrow, { autoAlpha: 1, x: 0, duration: 0.3, ease: "power2.out" }, tClimb + CLIMB + 0.3)
                .to(label("then"), show, tClimb + CLIMB + 0.25);

            revealSectionOnScroll(root, tl, "top 70%");
        });
    })();

    // Keep ScrollTrigger positions accurate across images, async webfont swaps,
    // CMS hydration, lazy image loads, and browser scroll-restoration.
    let refreshRaf = 0;
    function scheduleRefresh() {
        if (refreshRaf) return;
        refreshRaf = requestAnimationFrame(() => {
            refreshRaf = 0;
            ScrollTrigger.refresh();
            flushPendingReveals();
        });
    }

    runWhenLoaded(() => {
        ScrollTrigger.refresh();
        flushPendingReveals();
    });

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(scheduleRefresh);
    }

    if (typeof ResizeObserver !== "undefined" && document.body) {
        let lastHeight = document.body.scrollHeight;
        const bodyObserver = new ResizeObserver(() => {
            const nextHeight = document.body.scrollHeight;
            if (nextHeight !== lastHeight) {
                lastHeight = nextHeight;
                scheduleRefresh();
            }
        });
        bodyObserver.observe(document.body);
    }
});
