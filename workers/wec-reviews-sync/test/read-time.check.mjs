// Self-check for the read-time helpers: evaluates their source from the worker
// (they aren't exported, since a Worker module should only export its handler).
import assert from "node:assert";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const grab = (name) => src.match(new RegExp(`const ${name} = [\\s\\S]*?\\n};?\\n`))[0];
const { readMinutes, needsReadTime } = new Function(
  "const WPM = 200;\n" + grab("readMinutes") + grab("needsReadTime") + "return { readMinutes, needsReadTime };")();
const list = (n) => "<ul>" + Array.from({ length: n }, (_, i) => `<li>w${i}</li>`).join("") + "</ul>";
assert.equal(readMinutes({ body: list(400) }), 2);
assert.equal(readMinutes({ body: list(401) }), 3);
assert.equal(readMinutes({ body: "<p>hi</p>" }), 1);
assert.equal(readMinutes({ body: list(150), "key-takeaways": list(100) }), 2);
assert.equal(readMinutes({ body: "<p>A&nbsp;&amp;&nbsp;B</p>" }), 1);
const it = (rt, extra = {}) => ({ isArchived: false, isDraft: false, fieldData: { "read-time": rt }, ...extra });
assert.equal(needsReadTime(it(null)), true);
assert.equal(needsReadTime(it(undefined)), true);
assert.equal(needsReadTime(it(0)), true);
assert.equal(needsReadTime(it(5)), false);
assert.equal(needsReadTime(it(null, { isDraft: true })), false);
assert.equal(needsReadTime(it(null, { isArchived: true })), false);
console.log("read-time self-check passed");
