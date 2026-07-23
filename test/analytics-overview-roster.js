'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = source.indexOf('function ' + name + '(');
  assert.notStrictEqual(at, -1, name + ' exists');
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  throw new Error('unbalanced ' + name);
}

const sandbox = {
  allData: [
    { client_name: 'Current client', date: '2026-07-23' },
    { client_name: 'Former client', date: '2026-05-11' },
  ],
  clientMap: { 'Current client': {} },
};
vm.createContext(sandbox);
vm.runInContext([grabFunc('_buildHistories'), grabFunc('latestPerClient'), 'this.rows=latestPerClient();'].join('\n'), sandbox);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(sandbox.rows)),
  [{ client_name: 'Current client', date: '2026-07-23' }],
  'overview only contains current Clients Info roster members'
);
console.log('Analytics overview roster checks passed');
