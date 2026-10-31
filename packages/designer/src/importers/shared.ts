/** SHA-256 over UTF-8 source bytes, without a Node or browser-crypto dependency. */
export function sourceSha256(text: string): string {
  const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
  const primes: number[] = [];
  for (let n = 2; primes.length < 64; n++) if (!primes.some(p => n % p === 0)) primes.push(n);
  const fraction = (n: number) => ((n - Math.floor(n)) * 0x100000000) >>> 0;
  const constants = primes.map(p => fraction(Math.cbrt(p)));
  const hash = primes.slice(0, 8).map(p => fraction(Math.sqrt(p)));
  const bytes = [...new TextEncoder().encode(text)];
  const bits = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let index = 7; index >= 0; index--) bytes.push(Math.floor(bits / 2 ** (index * 8)) & 255);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words: number[] = [];
    for (let index = 0; index < 16; index++) {
      const pos = offset + index * 4;
      words.push(((bytes[pos]! << 24) | (bytes[pos + 1]! << 16) | (bytes[pos + 2]! << 8) | bytes[pos + 3]!) >>> 0);
    }
    for (let index = 16; index < 64; index++) {
      const a = words[index - 15]!, b = words[index - 2]!;
      words[index] = (words[index - 16]! + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + words[index - 7]! + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash as [number, number, number, number, number, number, number, number];
    for (let index = 0; index < 64; index++) {
      const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + constants[index]! + words[index]!) >>> 0;
      const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [a, b, c, d, e, f, g, h] = [(first + second) >>> 0, a, b, c, (d + first) >>> 0, e, f, g];
    }
    [a, b, c, d, e, f, g, h].forEach((value, index) => { hash[index] = (hash[index]! + value) >>> 0; });
  }
  return hash.map(value => value.toString(16).padStart(8, "0")).join("");
}
