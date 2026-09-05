// Read every row of a table, not the first 1000.
//
// PostgREST caps a response at 1000 rows and says nothing about it: a query
// that should return 1400 returns 1000 and an `error` of null. That is
// tolerable for a list a person scrolls, and not tolerable for a figure someone
// makes a decision on — the shutdown page's "money still owed" is the reason
// this exists.

export const PAGE_SIZE = 1000

export interface PageResult<T> {
  data:  T[] | null
  error: { message: string } | null
}

/**
 * Page through `read` until it returns a short page.
 *
 * The caller supplies the range because only it knows the query — filters,
 * columns, and the ORDER BY that makes the page boundaries stable. Without an
 * order, two pages of an unordered read may overlap or skip rows.
 */
export async function fetchAllRows<T>(
  read: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await read(offset, offset + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = data ?? []
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}
