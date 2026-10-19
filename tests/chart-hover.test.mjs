import test from 'node:test';
import assert from 'node:assert/strict';
import { hoverCardPosition } from '../src/chart-hover.js';

test('hover card clears the pointer across chart widths and edges', () => {
  for (const width of [280, 600, 1200]) {
    const cardWidth = Math.min(260, width - 16), cardHeight = 170;
    for (const pointerX of [66, width/2, width-24]) {
      for (const pointerY of [50, 150, 285]) {
        const p = hoverCardPosition({ pointerX, pointerY, guideX:pointerX,
          left:0,top:0,width,height:300,cardWidth,cardHeight });
        assert.ok(p.left >= 0 && p.left + cardWidth <= width);
        assert.ok(pointerX < p.left || pointerX > p.left + cardWidth
          || pointerY < p.top || pointerY > p.top + cardHeight);
      }
    }
  }
});

test('moving on the time axis keeps the card at the top and flips at the right edge', () => {
  const base = {pointerY:290,left:24,top:16,width:1000,height:300,cardWidth:260,cardHeight:170};
  const left = hoverCardPosition({...base,pointerX:100,guideX:100});
  const right = hoverCardPosition({...base,pointerX:990,guideX:990});
  assert.equal(left.top,24); assert.equal(right.top,24);
  assert.ok(left.left>100); assert.ok(right.left+260<990);
});
