// Is an IP address private, local or otherwise not a public internet address?
// Used by publicHost in index.ts before the connector fetches any link a person
// gives it (import_file, and every hop of a redirect). Plain JavaScript so a
// unit test runs it (test/higgsfield-private-ip.js).
//
// IPv6 covers every form an IPv4 address can hide in, because the URL parser
// rewrites "[::ffff:127.0.0.1]" to "[::ffff:7f00:1]": IPv4-mapped (::ffff:0:0/96),
// IPv4-compatible (::/96), NAT64 (64:ff9b::/96) and 6to4 (2002::/16) all carry an
// IPv4 address that is checked as IPv4. Anything that cannot be parsed counts as
// private (fail closed).

export function privateV4(a, b, c, d) {
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

// "1:2::3" -> [1, 2, 0, 0, 0, 0, 0, 3]; a trailing dotted IPv4 counts as two groups. null if malformed.
function expandV6(s) {
  let text = s;
  const dotted = text.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const q = dotted.slice(2, 6).map(Number);
    if (q.some((n) => n > 255)) return null;
    text = dotted[1] + ((q[0] << 8) | q[1]).toString(16) + ":" + ((q[2] << 8) | q[3]).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const part = (h) => (h === "" ? [] : h.split(":"));
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

export function privateIp(ip) {
  const raw = String(ip || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const v4 = raw.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const q = v4.slice(1, 5).map(Number);
    if (q.some((n) => n > 255)) return true;
    return privateV4(q[0], q[1], q[2], q[3]);
  }
  if (!raw.includes(":")) return true;
  const g = expandV6(raw);
  if (!g) return true;
  const embedded = (hi, lo) => privateV4(hi >> 8, hi & 255, lo >> 8, lo & 255);
  const zeros = (from, to) => g.slice(from, to).every((x) => x === 0);
  if (zeros(0, 8) || (zeros(0, 7) && g[7] === 1)) return true;                 // :: and ::1
  if (zeros(0, 5) && g[5] === 0xffff) return embedded(g[6], g[7]);             // ::ffff:a.b.c.d (mapped)
  if (zeros(0, 6)) return true;                                                // ::a.b.c.d (deprecated compat): never public
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return embedded(g[6], g[7]); // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]);                            // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true;                                 // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true;                                 // fe80::/10 link local
  if ((g[0] & 0xff00) === 0xff00) return true;                                 // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                         // documentation
  if (g[0] === 0x0100 && zeros(1, 4)) return true;                             // 100::/64 discard
  return false;
}
