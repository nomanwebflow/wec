if (typeof gsap === "undefined") {
    document.documentElement.classList.add("gsap-not-found");
}

document.addEventListener("DOMContentLoaded", () => {
    if (typeof gsap === "undefined") return;
    gsap.registerPlugin(ScrollTrigger);

    function splitHeadingIntoWords(heroRoot, headingSelector) {
        const heading = heroRoot.querySelector(headingSelector);
        const h2 = heading && heading.querySelector("h1, h2, h3, p");
        if (!h2 || h2.dataset.split) return heroRoot.querySelectorAll(".word-inner");

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
        return heroRoot.querySelectorAll(".word-inner");
    }

    function animateHeroBackdrop(tl, heroRoot) {
        // DOM order of the mobile/desktop bg images isn't fixed — the CSS picks
        // which one is on screen per breakpoint via data-hero-image, so animate
        // whichever one is actually visible, never a fixed DOM position.
        const topImage = [...heroRoot.querySelectorAll(".hero_bg_image")].find(
            (img) => getComputedStyle(img).display !== "none"
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

    // --- Main homepage hero: eyebrow tag -> headline -> copy -> buttons -> divider -> badge -> features ---
    (function initHeroMain() {
        const heroRoot = document.querySelector('[data-animation-trigger="hero-main"]');
        if (!heroRoot) return;
        gsap.set(heroRoot, { visibility: "visible" });

        const tag = heroRoot.querySelector(".tag_wrap");
        const copy = heroRoot.querySelector(".u-text.u-rich-text");
        const buttons = heroRoot.querySelectorAll(".u-button-wrapper .u-display-contents > *");
        const divider = heroRoot.querySelector(".hero_main_divider");
        const badge = heroRoot.querySelector(".reviews-badge_outer");
        const features = heroRoot.querySelectorAll(".features_item");
        const words = splitHeadingIntoWords(heroRoot, ".hero_main_content .u-heading");

        const tl = gsap.timeline({
            scrollTrigger: { trigger: heroRoot, start: "top 80%", once: true }
        });

        animateHeroBackdrop(tl, heroRoot);

        tl.set(words, { yPercent: 115, rotate: 3 }, 0)
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
    })();

    // --- Services/condition page hero: badge -> headline -> copy -> buttons -> divider -> features ---
    (function initHeroServices() {
        const heroRoot = document.querySelector('[data-animation-trigger="services-hero"]');
        if (!heroRoot) return;
        gsap.set(heroRoot, { visibility: "visible" });

        const layout = heroRoot.querySelector(".services_hero_layout");
        const badge = heroRoot.querySelector(".reviews-badge_outer");
        const copy = heroRoot.querySelector(".u-text.u-rich-text");
        const buttons = heroRoot.querySelectorAll(".u-button-wrapper .u-display-contents > *");
        const divider = heroRoot.querySelector(".services_hero_divder");
        const features = heroRoot.querySelectorAll(".features_item");
        const words = splitHeadingIntoWords(layout, ".u-heading");

        const tl = gsap.timeline({
            scrollTrigger: { trigger: heroRoot, start: "top 80%", once: true }
        });

        animateHeroBackdrop(tl, heroRoot);

        tl.set(badge, { opacity: 0, y: 10 }, 0)
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
    })();

    // --- Scroll-reveal content + image gallery section: icon -> headline -> copy -> button -> images ---
    (function initGallerySection() {
        const sections = document.querySelectorAll('[data-animation-trigger="gallery"]');
        sections.forEach((sectionRoot) => {
            gsap.set(sectionRoot, { visibility: "visible" });

            const icon = sectionRoot.querySelector(".heading_icon");
            const copy = sectionRoot.querySelector(".u-text.u-rich-text");
            const buttons = sectionRoot.querySelectorAll(".u-button-wrapper .u-display-contents > *");
            const largeImage = sectionRoot.querySelector(".services_who_visual_wrap.is-large");
            const smallImage = sectionRoot.querySelector(".services_who_visual_wrap.is-small");
            const largeImg = largeImage && largeImage.querySelector("img");
            const smallImg = smallImage && smallImage.querySelector("img");
            const words = splitHeadingIntoWords(sectionRoot, ".heading_wrap .u-heading");

            const tl = gsap.timeline({
                scrollTrigger: { trigger: sectionRoot, start: "top 80%", once: true }
            });

            tl.set(icon, { autoAlpha: 0, scaleY: 0, transformOrigin: "top center" }, 0)
                .set(words, { yPercent: 115, rotate: 3 }, 0)
                .set(copy, { opacity: 0, y: 14 }, 0)
                .set(buttons, { opacity: 0, y: 10 }, 0)
                // Each wrap's own box clips the reveal; the wipe direction differs per
                // image so the two frames don't feel like one mechanical repeat.
                // "round 16px" keeps the wrap's own corner radius intact mid-wipe
                // instead of squaring it off while the clip shape animates.
                .set(largeImage, { clipPath: "inset(0px 100% 0px 0px round 16px)" }, 0)
                .set(smallImage, { clipPath: "inset(0px 0px 0px 100% round 16px)" }, 0)
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
                // Button lands with a touch of anticipation, no cartoon bounce.
                .to(buttons, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "back.out(1.4)" }, 0.75)
                // Large frame wipes open left-to-right; its photo settles back into place as the clip reveals it.
                // Paced to land alongside the text sequence instead of finishing early.
                .to(largeImage, { clipPath: "inset(0px 0% 0px 0px round 16px)", duration: 1.1, ease: "power4.inOut" }, 0.2)
                .to(largeImg, { scale: 1, xPercent: 0, duration: 1.3, ease: "power3.out" }, 0.2)
                // Small frame wipes open right-to-left, offset later so the two don't land together.
                .to(smallImage, { clipPath: "inset(0px 0px 0px 0% round 16px)", duration: 1, ease: "power4.inOut" }, 0.5)
                .to(smallImg, { scale: 1, xPercent: 0, duration: 1.2, ease: "power3.out" }, 0.5);
        });
    })();

    // --- Scroll-reveal content + single image section: icon -> headline -> copy -> callout -> image ---
    (function initCausesSection() {
        const sections = document.querySelectorAll('[data-animation-trigger="causes"]');
        sections.forEach((sectionRoot) => {
            gsap.set(sectionRoot, { visibility: "visible" });

            const icon = sectionRoot.querySelector(".heading_icon");
            const copy = sectionRoot.querySelector(".u-text.u-rich-text");
            const callout = sectionRoot.querySelector(".services_causes_content > div:last-child");
            const imageWrap = sectionRoot.querySelector(".services_causes_visual");
            const img = imageWrap && imageWrap.querySelector("img");
            const words = splitHeadingIntoWords(sectionRoot, ".heading_wrap .u-heading");

            const tl = gsap.timeline({
                scrollTrigger: { trigger: sectionRoot, start: "top 80%", once: true }
            });

            tl.set(icon, { autoAlpha: 0, scaleY: 0, transformOrigin: "top center" }, 0)
                .set(words, { yPercent: 115, rotate: 3 }, 0)
                .set(copy, { opacity: 0, y: 14 }, 0)
                .set(callout, { opacity: 0, y: 14 }, 0)
                // "round 16px" keeps the image wrap's own corner radius intact
                // mid-wipe instead of squaring it off while the clip animates.
                .set(imageWrap, { clipPath: "inset(0px 100% 0px 0px round 16px)" }, 0)
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
                .to(imageWrap, { clipPath: "inset(0px 0% 0px 0px round 16px)", duration: 1.2, ease: "power4.inOut" }, 0.2)
                .to(img, { scale: 1, xPercent: 0, duration: 1.4, ease: "power3.out" }, 0.2);
        });
    })();
});
