const TEAMS = Object.freeze(["video", "graphics"]);

function clean(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

export function pendingAgeThresholdMinutes(value, fallback = 30) {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value.minutes
    : value;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes >= 1 && minutes <= 24 * 60
    ? Math.round(minutes)
    : fallback;
}

export function pendingAgeAlertTeams(oldestByTeam = {}, authorityByTeam = {}, threshold = 30) {
  return TEAMS.filter(team => {
    const age = Number(oldestByTeam[team]);
    return clean(authorityByTeam[team]) === "syncview"
      && Number.isFinite(age)
      && age > threshold;
  });
}
