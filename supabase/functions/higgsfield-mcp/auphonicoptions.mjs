// voice_cleanup "options": every Auphonic algorithm setting a person could set with their own Auphonic key,
// so nobody needs one (Sidney 2026-11-06). The table is Auphonic's own list, from
// https://auphonic.com/api/info/algorithms.json (read 2026-11-06): each setting is a checkbox (true or false)
// or a choice from a fixed list of values. Only these names and values are ever sent to Auphonic; anything
// else is refused with a sentence, never passed on. Left out on purpose: the multitrack settings (track gain,
// fore/background, ducking, mic bleed, sync tracks) and "segments", which do nothing for one recording.
// Plain JavaScript with no Deno parts (tested by test/higgsfield-voice-cleanup.js).

export const AUPHONIC_OPTIONS = {
  denoise: { t: "bool" },
  denoisemethod: { t: "enum", v: ["classic", "dynamic", "speech_isolation", "static"] },
  denoiseamount: { t: "enum", v: [0, -1, 3, 6, 9, 12, 15, 18, 24, 30, 36, 100] },
  debreathamount: { t: "enum", v: [-1, 3, 6, 9, 12, 15, 18, 24, 30, 36, 100] },
  dehum: { t: "enum", v: [0, 50, 60] },
  dehumamount: { t: "enum", v: [0, -1, 3, 6, 9, 12, 15, 18, 24, 30, 100] },
  filtering: { t: "bool" },
  filtermethod: { t: "enum", v: ["hipfilter", "autoeq", "bwe", "studiovoice"] },
  leveler: { t: "bool" },
  compressor: { t: "enum", v: ["auto", "off", "soft", "medium", "hard"] },
  compressor_m: { t: "enum", v: ["Same", "auto", "off", "soft", "medium", "hard"] },
  levelerstrength: { t: "enum", v: [120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0] },
  levelerstrength_m: { t: "enum", v: [-1, 120, 110, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 0] },
  maxlra: { t: "enum", v: [0, 3, 4, 5, 6, 8, 9, 10, 12, 15, 18, 20, 25, 30] },
  maxs: { t: "enum", v: [0, 3, 4, 5, 6, 8, 9, 10, 12] },
  maxm: { t: "enum", v: [0, 8, 9, 10, 11, 12, 15, 18, 20] },
  musicgain: { t: "enum", v: [-6, -5, -4, -3, -2, 0, 2, 3, 4, 5, 6] },
  msclassifier: { t: "enum", v: ["on", "speech", "music"] },
  pan: { t: "enum", v: ["L100", "L75", "L50", "L25", "L20", "L15", "L10", "L05", "C", "R05", "R10", "R15", "R20", "R25", "R50", "R75", "R100"] },
  normloudness: { t: "bool" },
  loudnesstarget: { t: "enum", v: [-13, -14, -15, -16, -18, -19, -20, -23, -24, -26, -27, -31] },
  maxpeak: { t: "enum", v: [99.0, 0.0, -0.5, -1.0, -1.5, -2.0, -3.0, -4.0, -5.0, -6.0, -9.0] },
  dualmono: { t: "bool" },
  loudnessmethod: { t: "enum", v: ["program", "dialog", "rms"] },
  gate: { t: "bool" },
  cutter: { t: "bool" },
  silence_cutter: { t: "bool" },
  filler_cutter: { t: "bool" },
  cough_cutter: { t: "bool" },
  music_cutter: { t: "bool" },
  cut_mode: { t: "enum", v: ["apply_cuts", "export_uncut_audio", "set_cuts_to_silence"] },
};

// A setting that only means something while its group's checkbox is on: giving the setting switches the
// group on, unless the person set the group's checkbox themselves.
export const GROUP_OF = {
  denoisemethod: "denoise", denoiseamount: "denoise",
  filtermethod: "filtering",
  compressor: "leveler", compressor_m: "leveler", levelerstrength: "leveler", levelerstrength_m: "leveler",
  maxlra: "leveler", maxs: "leveler", maxm: "leveler", musicgain: "leveler", msclassifier: "leveler",
  loudnesstarget: "normloudness", maxpeak: "normloudness", dualmono: "normloudness", loudnessmethod: "normloudness",
  silence_cutter: "cutter", filler_cutter: "cutter", cough_cutter: "cutter", music_cutter: "cutter", cut_mode: "cutter",
};

// The person's settings as an object (or JSON text) -> { algorithms } to lay over the preset, or { error }.
export function parseOptions(raw) {
  if (raw === undefined || raw === null || raw === "") return { algorithms: {} };
  let o = raw;
  if (typeof o === "string") { try { o = JSON.parse(o); } catch { return { error: "options must be an object like {\"denoiseamount\": 24, \"leveler\": true}." }; } }
  if (!o || typeof o !== "object" || Array.isArray(o)) return { error: "options must be an object like {\"denoiseamount\": 24, \"leveler\": true}." };
  const algorithms = {};
  for (const [name, value] of Object.entries(o)) {
    const key = String(name).trim().toLowerCase();
    const spec = Object.prototype.hasOwnProperty.call(AUPHONIC_OPTIONS, key) ? AUPHONIC_OPTIONS[key] : null;
    if (!spec) return { error: `"${String(name).slice(0, 40)}" is not an Auphonic setting I can set. Settings: ${Object.keys(AUPHONIC_OPTIONS).join(", ")}.` };
    if (spec.t === "bool") {
      if (value !== true && value !== false) return { error: `${key} must be true or false.` };
      algorithms[key] = value;
    } else {
      const hit = spec.v.find((x) => x === value || (typeof x === "number" && typeof value === "string" && value.trim() !== "" && Number(value) === x) || (typeof x === "string" && typeof value === "string" && x.toLowerCase() === value.trim().toLowerCase()));
      if (hit === undefined) return { error: `${key} must be one of: ${spec.v.join(", ")}.` };
      algorithms[key] = hit;
    }
  }
  for (const [child, group] of Object.entries(GROUP_OF)) {
    if (child in algorithms && !(group in algorithms)) algorithms[group] = true;
  }
  return { algorithms };
}

// One line for the price card.
export function optionsText(algorithms) {
  const e = Object.entries(algorithms || {});
  return e.length ? e.map(([k, v]) => `${k} ${v}`).join(", ") : "";
}
