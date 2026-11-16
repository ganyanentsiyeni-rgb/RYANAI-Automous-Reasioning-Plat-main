const VERSION = 5;
const SIZE = 17 + VERSION * 4;
const DATA_CODEWORDS = 108;
const ECC_CODEWORDS = 26;

function multiply(x: number, y: number): number {
  let result = 0;
  for (let i = 7; i >= 0; i--) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    result ^= ((y >>> i) & 1) * x;
  }
  return result;
}

function generatorPolynomial(degree: number): number[] {
  let polynomial = [1];
  let root = 1;
  for (let i = 0; i < degree; i++) {
    const next = Array(polynomial.length + 1).fill(0) as number[];
    polynomial.forEach((value, index) => {
      next[index] ^= value;
      next[index + 1] ^= multiply(value, root);
    });
    polynomial = next;
    root = multiply(root, 2);
  }
  return polynomial;
}

function errorCorrection(data: number[]): number[] {
  const generator = generatorPolynomial(ECC_CODEWORDS);
  const remainder = Array(ECC_CODEWORDS).fill(0) as number[];
  for (const byte of data) {
    const factor = byte ^ remainder.shift()!;
    remainder.push(0);
    for (let i = 0; i < ECC_CODEWORDS; i++) remainder[i] ^= multiply(generator[i + 1], factor);
  }
  return remainder;
}

function makeCodewords(value: string): number[] {
  const bytes = Array.from(new TextEncoder().encode(value));
  if (bytes.length > 106) throw new Error('The PhoneLink pairing URL is too long for the QR payload.');
  const bits: number[] = [];
  const append = (value: number, count: number) => {
    for (let bit = count - 1; bit >= 0; bit--) bits.push((value >>> bit) & 1);
  };
  append(0b0100, 4);
  append(bytes.length, 8);
  bytes.forEach(byte => append(byte, 8));
  for (let i = 0; i < Math.min(4, DATA_CODEWORDS * 8 - bits.length); i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((value, bit) => (value << 1) | bit, 0));
  for (let pad = 0; data.length < DATA_CODEWORDS; pad++) data.push(pad % 2 === 0 ? 0xec : 0x11);
  return [...data, ...errorCorrection(data)];
}

export function createPhoneLinkQr(value: string): boolean[][] {
  const modules = Array.from({ length: SIZE }, () => Array(SIZE).fill(false) as boolean[]);
  const reserved = Array.from({ length: SIZE }, () => Array(SIZE).fill(false) as boolean[]);
  const set = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    modules[y][x] = dark;
    reserved[y][x] = true;
  };
  const finder = (cx: number, cy: number) => {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const x = cx + dx, y = cy + dy;
      const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const dark = inside && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      set(x, y, dark);
    }
  };
  finder(0, 0); finder(SIZE - 7, 0); finder(0, SIZE - 7);

  for (let i = 8; i < SIZE - 8; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }

  for (const [cx, cy] of [[30, 30]]) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  const format = 0x77c4; // Error correction L, mask pattern 0.
  for (let i = 0; i <= 5; i++) set(8, i, ((format >>> i) & 1) !== 0);
  set(8, 7, ((format >>> 6) & 1) !== 0);
  set(8, 8, ((format >>> 7) & 1) !== 0);
  set(7, 8, ((format >>> 8) & 1) !== 0);
  for (let i = 9; i < 15; i++) set(14 - i, 8, ((format >>> i) & 1) !== 0);
  for (let i = 0; i < 8; i++) set(SIZE - 1 - i, 8, ((format >>> i) & 1) !== 0);
  for (let i = 8; i < 15; i++) set(8, SIZE - 15 + i, ((format >>> i) & 1) !== 0);
  set(8, SIZE - 8, true);

  const codewords = makeCodewords(value);
  const dataBits = codewords.flatMap(byte => Array.from({ length: 8 }, (_, bit) => (byte >>> (7 - bit)) & 1));
  let bitIndex = 0;
  let upward = true;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right--;
    for (let vert = 0; vert < SIZE; vert++) {
      const y = upward ? SIZE - 1 - vert : vert;
      for (let offset = 0; offset < 2; offset++) {
        const x = right - offset;
        if (reserved[y][x]) continue;
        let dark = bitIndex < dataBits.length ? dataBits[bitIndex++] === 1 : false;
        if ((x + y) % 2 === 0) dark = !dark;
        modules[y][x] = dark;
      }
    }
    upward = !upward;
  }
  return modules;
}
