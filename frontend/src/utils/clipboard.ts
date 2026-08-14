export async function copyText(text: string): Promise<void> {
  if (!text) return
  await navigator.clipboard.writeText(text)
}

