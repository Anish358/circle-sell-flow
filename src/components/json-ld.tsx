/**
 * Structured data, serialised safely.
 *
 * React escapes text it renders into JSX, which is why the rest of the app needs no
 * thought about seller-supplied strings. It does **not** escape the contents of a
 * `<script>` tag — that content is raw, by design, and has to be set through
 * `dangerouslySetInnerHTML`.
 *
 * So a listing titled `</script><script>…` would close this tag early and execute. This
 * is the one place in a React app where seller text is a live injection vector, and it
 * is easy to miss precisely because everywhere else is safe by default.
 *
 * `JSON.stringify` alone is not enough: it leaves `<`, `>` and `&` untouched, since they
 * are legal inside a JSON string. Escaping them as unicode sequences keeps the JSON
 * exactly equivalent for any parser while making an early `</script>` impossible.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serialiseForScriptTag(data) }}
    />
  )
}

export function serialiseForScriptTag(data: unknown): string {
  return (
    JSON.stringify(data)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      // U+2028 and U+2029 are valid in JSON strings but are line terminators in
      // JavaScript, so an unescaped one is a syntax error in the browser.
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029")
  )
}
