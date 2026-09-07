import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {crc32, inflateSync} from 'node:zlib';
import test from 'node:test';
test('browser media fixture has valid PNG chunks and complete RGBA scanlines', () => {
  const png = readFileSync(new URL('./fixtures/frontend-media.png', import.meta.url));
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  const chunks = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    assert.equal(png.readUInt32BE(offset + 8 + length), crc32(png.subarray(offset + 4, offset + 8 + length)), `${type} checksum`);
    chunks.push({type, data});
    offset += length + 12;
  }
  assert.equal(offset, png.length);
  assert.deepEqual(chunks.map(c => c.type), ['IHDR', 'IDAT', 'IEND']);
  assert.equal(chunks[0].data.readUInt32BE(0), 2);
  assert.equal(chunks[0].data.readUInt32BE(4), 2);
  assert.equal(chunks[0].data[9], 6);
  assert.equal(inflateSync(chunks[1].data).length, 18);
});
