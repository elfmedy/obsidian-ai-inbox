/** Node Buffer.slice() is a view into a possibly larger allocation. Vault APIs
 * take an ArrayBuffer, so copy precisely the visible bytes into owned storage. */
export function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
