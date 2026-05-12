// Real client profiles + recent thumbnails — populated as we build them.
// User edits via the creator are saved to localStorage under 'sync_profiles' and merged with seeds.
window.SEEDED_PROFILES = [
  {
    id: 'baya-voce',
    name: 'Baya Voce',
    handle: '@bayavoce',
    colors: ['#FFFFFF', '#E81E1E', '#000000', '#1A1A1A'],
    accent: '#E81E1E',     // red emphasis color
    secondary: '#FFFFFF',  // white primary text
    font: 'Inter Tight',
    fontWeight: 900,
    fontUrl: 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@900&display=swap',
    style: 'Reels',
    layouts: ['centered-bottom-twotone'],
    // Two-tone rule: last line (or last 2 words) render in accent red, rest in white.
    // No backgrounds — text sits directly on the image, no stroke, slight shadow for legibility.
    textCase: 'sentence',  // "Why you keep fighting" (not all-caps)
    emphasisRule: 'last-line', // last line of headline takes the accent color
    sampleHeadlines: [
      'Why you keep fighting over nothing',
      'The biggest lie about being emotionally regulated',
      'What to do when their best still isn\'t enough',
    ],
    createdAt: Date.now(),
  },
];
window.CLIENT_PROFILES = [...window.SEEDED_PROFILES];
window.RECENT_THUMBS = [];

// Candidate frames for the smart-picks (mock results from ffmpeg+scoring)
// Used by the frame-picker demo until real video extraction is wired up.
window.SMART_PICKS = [
  { id: 'f1', img: 'https://picsum.photos/seed/frame-a/640/360', time: '00:12.4', score: 94, signals: ['big face', 'smile', 'sharp'] },
  { id: 'f2', img: 'https://picsum.photos/seed/frame-b/640/360', time: '01:34.0', score: 91, signals: ['surprise', 'centered'] },
  { id: 'f3', img: 'https://picsum.photos/seed/frame-c/640/360', time: '02:48.7', score: 88, signals: ['mouth open', 'sharp'] },
  { id: 'f4', img: 'https://picsum.photos/seed/frame-d/640/360', time: '04:11.2', score: 84, signals: ['big face'] },
  { id: 'f5', img: 'https://picsum.photos/seed/frame-e/640/360', time: '05:33.9', score: 82, signals: ['eyes open', 'sharp'] },
  { id: 'f6', img: 'https://picsum.photos/seed/frame-f/640/360', time: '07:02.1', score: 79, signals: ['composition'] },
  { id: 'f7', img: 'https://picsum.photos/seed/frame-g/640/360', time: '08:21.0', score: 76, signals: ['smile'] },
  { id: 'f8', img: 'https://picsum.photos/seed/frame-h/640/360', time: '09:48.5', score: 74, signals: ['big face'] },
  { id: 'f9', img: 'https://picsum.photos/seed/frame-i/640/360', time: '11:07.3', score: 71, signals: ['sharp'] },
];

// Curated font options for the profile creator. Free-google-fonts only.
window.FONT_OPTIONS = [
  { name: 'Anton', weight: '400', url: 'https://fonts.googleapis.com/css2?family=Anton&display=swap', vibe: 'condensed, bold' },
  { name: 'Archivo Black', weight: '400', url: 'https://fonts.googleapis.com/css2?family=Archivo+Black&display=swap', vibe: 'heavy, geometric' },
  { name: 'Bricolage Grotesque', weight: '800', url: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@800&display=swap', vibe: 'modern, friendly' },
  { name: 'Space Grotesk', weight: '700', url: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&display=swap', vibe: 'technical, clean' },
  { name: 'Bebas Neue', weight: '400', url: 'https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap', vibe: 'tall, condensed' },
  { name: 'Oswald', weight: '700', url: 'https://fonts.googleapis.com/css2?family=Oswald:wght@700&display=swap', vibe: 'narrow, bold' },
  { name: 'Bowlby One', weight: '400', url: 'https://fonts.googleapis.com/css2?family=Bowlby+One&display=swap', vibe: 'chunky, playful' },
  { name: 'Russo One', weight: '400', url: 'https://fonts.googleapis.com/css2?family=Russo+One&display=swap', vibe: 'industrial' },
  { name: 'Bungee', weight: '400', url: 'https://fonts.googleapis.com/css2?family=Bungee&display=swap', vibe: 'urban, signage' },
  { name: 'DM Sans', weight: '900', url: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@900&display=swap', vibe: 'neutral, modern' },
  { name: 'Inter Tight', weight: '900', url: 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@900&display=swap', vibe: 'tight, modern' },
  { name: 'Unbounded', weight: '800', url: 'https://fonts.googleapis.com/css2?family=Unbounded:wght@800&display=swap', vibe: 'futuristic' },
];

window.LAYOUT_OPTIONS = [
  { id: 'centered-bottom-twotone', label: 'Two-tone bottom' },
  { id: 'big-text-left', label: 'Big text left' },
  { id: 'centered-bottom', label: 'Centered bottom' },
  { id: 'split-screen', label: 'Split / strip' },
  { id: 'top-strip', label: 'Top strip' },
];

// ───── Profile persistence ─────
window.loadProfiles = function() {
  try {
    const raw = localStorage.getItem('sync_profiles');
    const userProfiles = raw ? JSON.parse(raw) : [];
    // Merge seeds + user-created/edited. User overrides win by id.
    const merged = [...(window.SEEDED_PROFILES || [])];
    userProfiles.forEach(up => {
      const i = merged.findIndex(m => m.id === up.id);
      if (i >= 0) merged[i] = up; else merged.push(up);
    });
    return merged;
  } catch (e) { return [...(window.SEEDED_PROFILES || [])]; }
};
window.saveProfiles = function(profiles) {
  localStorage.setItem('sync_profiles', JSON.stringify(profiles));
  window.CLIENT_PROFILES = profiles;
};

// ───── Color extraction ─────
// Sample dominant colors from an image. Returns up to `count` hex strings.
window.extractPalette = function(imgEl, count = 5) {
  const c = document.createElement('canvas');
  const size = 80;
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.drawImage(imgEl, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue;
    // Quantize to 6-bit per channel (64 buckets per channel)
    const r = data[i] & 0xF0;
    const g = data[i + 1] & 0xF0;
    const b = data[i + 2] & 0xF0;
    // Skip near-black and near-white (background-y colors)
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 40) continue; // too black
    if (min > 230) continue; // too white
    const key = (r << 16) | (g << 8) | b;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  // Deduplicate: enforce minimum color distance between picks
  const picks = [];
  for (const [key] of sorted) {
    const r = (key >> 16) & 0xFF, g = (key >> 8) & 0xFF, b = key & 0xFF;
    const tooClose = picks.some(p => Math.abs(p.r - r) + Math.abs(p.g - g) + Math.abs(p.b - b) < 80);
    if (tooClose) continue;
    picks.push({ r, g, b });
    if (picks.length >= count) break;
  }
  return picks.map(({ r, g, b }) =>
    '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()
  );
};
