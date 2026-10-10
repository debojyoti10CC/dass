/** Only bound read/simulation work. A timeout must never stand in for a transaction receipt. */
export async function withReviewDeadline<T>(work: Promise<T>, timeoutMs = 35000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Forecast review timed out while reading the network or wallet. No approval or forecast transaction was requested. Check your wallet connection and try Review forecast again.')), timeoutMs)
    })])
  } finally { clearTimeout(timer) }
}
