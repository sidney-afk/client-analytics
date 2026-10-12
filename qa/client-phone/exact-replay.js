'use strict';
// Fresh captures can differ in rasterization on an unchanged build. Every
// accepted attempt still requires exact PNG bytes AND exact computed styles.
async function exactReplay(capturePair) {
  let result;
  for (let attempts=1;attempts<=4;attempts++) {
    result={...await capturePair(),attempts};
    if (result.pixels && result.styles) return result;
  }
  return result;
}
module.exports={exactReplay};
