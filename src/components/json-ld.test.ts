import { describe, expect, it } from "vitest"

import { serialiseForScriptTag } from "./json-ld"

/**
 * The one place in a React app where seller-supplied text is a live injection vector,
 * because `<script>` contents are raw by design. These tests are the reason to trust it.
 */
describe("serialiseForScriptTag", () => {
  it("makes an early </script> impossible", () => {
    const hostile = { name: "</script><script>alert(1)</script>" }
    const output = serialiseForScriptTag(hostile)

    expect(output).not.toContain("</script>")
    expect(output).not.toContain("<script")
    expect(output).toContain("\\u003c")
  })

  it("escapes every character that can break out of a script tag", () => {
    const output = serialiseForScriptTag({ name: "<>&" })
    expect(output).not.toMatch(/[<>&]/)
  })

  it("escapes the line terminators that are legal JSON but invalid JavaScript", () => {
    // U+2028 and U+2029 pass JSON.stringify untouched and then break the parser.
    const output = serialiseForScriptTag({ name: "a\u2028b\u2029c" })
    expect(output).not.toContain("\u2028")
    expect(output).not.toContain("\u2029")
  })

  it("still produces JSON that parses back to the original value", () => {
    // Escaping must not change meaning — the whole point is that it is a no-op for a
    // parser and a barrier for an HTML tokeniser.
    const original = {
      name: "Sofa <b>grey</b> &  comfy",
      price: 14500,
      nested: { list: ["a<b", "c>d"] },
    }
    expect(JSON.parse(serialiseForScriptTag(original))).toEqual(original)
  })

  it("handles the ordinary case unchanged", () => {
    expect(JSON.parse(serialiseForScriptTag({ a: 1 }))).toEqual({ a: 1 })
  })
})
