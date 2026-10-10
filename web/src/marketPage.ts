export function marketPageIds(count: bigint, page: number): bigint[] {
  if (!Number.isSafeInteger(page) || page < 0) throw new Error('Invalid market page.')
  const ids: bigint[] = [], end = count - BigInt(page) * 20n
  for (let id = end; id > 0n && id > end - 20n; id--) ids.push(id)
  return ids
}
