/** SHA-256 round constants (FIPS 180-4), stored as 32-bit words. */
const K = Int32Array.from([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
/** Message schedule scratch; sha256 is synchronous and never re-enters. */
const W = new Int32Array(64);
const encoder = new TextEncoder();
const rotr = (n: number, bits: number) => (n >>> bits) | (n << (32 - bits));
/** SHA-256 over UTF-8, synchronous and platform-neutral for pinned adopted copies. */
export function sha256(text: string): string {
  const data = encoder.encode(text), length = data.length;
  // Padding: 0x80, zeros to 56 mod 64, then the 64-bit big-endian bit length.
  const blocks = Math.ceil((length + 9) / 64), bytes = new Uint8Array(blocks * 64);
  bytes.set(data); bytes[length] = 0x80;
  const bitLength = length * 8, high = Math.floor(bitLength / 0x100000000), low = bitLength >>> 0, end = bytes.length;
  for (let shift = 24, at = end - 8; shift >= 0; shift -= 8, at++) { bytes[at] = (high >>> shift) & 255; bytes[at + 4] = (low >>> shift) & 255; }
  let h0 = 0x6a09e667 | 0, h1 = 0xbb67ae85 | 0, h2 = 0x3c6ef372 | 0, h3 = 0xa54ff53a | 0, h4 = 0x510e527f | 0, h5 = 0x9b05688c | 0, h6 = 0x1f83d9ab | 0, h7 = 0x5be0cd19 | 0;
  for (let offset = 0; offset < end; offset += 64) {
    for (let i = 0, p = offset; i < 16; i++, p += 4) W[i] = (bytes[p]! << 24) | (bytes[p + 1]! << 16) | (bytes[p + 2]! << 8) | bytes[p + 3]!;
    for (let i = 16; i < 64; i++) { const a = W[i - 15]!, b = W[i - 2]!; W[i] = (W[i - 16]! + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + W[i - 7]! + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0; }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + W[i]!) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  let hex = "";
  for (const word of [h0, h1, h2, h3, h4, h5, h6, h7]) hex += (word >>> 0).toString(16).padStart(8, "0");
  return hex;
}
