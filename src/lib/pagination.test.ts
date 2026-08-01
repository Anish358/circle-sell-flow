import { describe, expect, it } from "vitest"

import { pageHref, readPage } from "./pagination"

/**
 * The page number arrives from a URL, so most of what matters here is what happens when
 * it is not the number the UI would have produced.
 */

describe("readPage", () => {
  it("describes the first page", () => {
    const page = readPage(undefined, 10, 22)

    expect(page).toMatchObject({
      number: 1,
      offset: 0,
      from: 1,
      to: 10,
      totalPages: 3,
      hasPrevious: false,
      hasNext: true,
    })
  })

  it("describes a middle and a last page", () => {
    expect(readPage("2", 10, 22)).toMatchObject({ offset: 10, from: 11, to: 20, hasNext: true })
    expect(readPage("3", 10, 22)).toMatchObject({ offset: 20, from: 21, to: 22, hasNext: false })
  })

  it("clamps a page past the end instead of showing an empty screen", () => {
    // Reachable by a bookmark after rows are removed, and by anyone editing the URL. The
    // last page is a better answer than nothing, with no way back.
    expect(readPage("99", 10, 22).number).toBe(3)
  })

  it("treats anything that is not a positive integer as page one", () => {
    for (const raw of ["0", "-3", "abc", "1.5", "", " ", undefined]) {
      expect(readPage(raw, 10, 22).number, JSON.stringify(raw)).toBe(1)
    }
    // A negative offset would be a SQL error rather than a wrong page.
    expect(readPage("-3", 10, 22).offset).toBe(0)
  })

  it("takes the last value when a parameter is repeated", () => {
    expect(readPage(["1", "2"], 10, 22).number).toBe(2)
  })

  it("stays coherent with nothing to show", () => {
    expect(readPage("2", 10, 0)).toMatchObject({
      number: 1,
      totalPages: 1,
      from: 0,
      to: 0,
      hasPrevious: false,
      hasNext: false,
    })
  })
})

describe("pageHref", () => {
  it("keeps the rest of the query, so paging does not drop a search", () => {
    expect(pageHref("q=battery", 2)).toBe("?q=battery&page=2")
  })

  it("drops the parameter on page one rather than writing page=1", () => {
    // The canonical URL for the first page is the one without it — two URLs for one page
    // is a duplicate for a crawler and a difference for a cache.
    expect(pageHref("q=battery&page=3", 1)).toBe("?q=battery")
    expect(pageHref("page=2", 1)).toBe("?")
  })

  it("replaces an existing page rather than appending a second one", () => {
    expect(pageHref("page=2", 5)).toBe("?page=5")
  })
})
