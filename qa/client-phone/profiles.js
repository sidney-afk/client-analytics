'use strict';
// Owner's review devices. Legacy CI widths remain independent regression checks.
const PROFILES = Object.freeze([
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
  { id: 'iphone-pro', label: 'iPhone 14 Pro / 16 Pro', width: 393, height: 852, isMobile: true, hasTouch: true },
  { id: 'android', label: 'Android', width: 412, height: 915, isMobile: true, hasTouch: true },
]);
function heightFor(width, override) {
  const height = override === undefined ? PROFILES.find(profile => profile.width === width)?.height || 844 : Number(override);
  if (!Number.isInteger(height) || height <= 0) throw new Error('Invalid viewport height');
  return height;
}
module.exports = { PROFILES, heightFor };
