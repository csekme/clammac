/** PUA hits are advisory: often false positives on dev tools — never auto-quarantined. */
export function isPuaSignature(signature: string): boolean {
  return signature.startsWith('PUA.')
}
