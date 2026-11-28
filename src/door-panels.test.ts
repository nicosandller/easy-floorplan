import { it, expect } from 'vitest';
import { openingSolids } from './projection-openings';
import { openingForm } from './editor-forms';
import type { Opening } from './types';
const door: Opening = {id:'d',type:'door',x:0,y:0,length:80,angle:0,panels:[{height:1,material:'solid'},{height:1,material:'glass'}]};
it('moves solid and glazed infill together as one leaf',()=>{
 const p=openingSolids(door,{color:'#555',amount:1},(x,y)=>({x,y}),100).filter(p=>p.kind==='panel');
 expect(p).toHaveLength(2);expect(p[0].base).toEqual(p[1].base);
 expect(p.map(p=>[p.z0,p.z1,p.glazed,p.framed])).toEqual([[0,42.5,false,true],[42.5,85,true,true]]);
 expect(p[0].base[1].y).toBeCloseTo(-80);
});
it('subdivides both leaves and keeps three equal rails aligned',()=>{
 const p=openingSolids({...door,sash:'double',panels:Array.from({length:3},()=>({material:'glass' as const}))},{color:'#555',amount:0},(x,y)=>({x,y}),100).filter(p=>p.kind==='panel');
 expect(p).toHaveLength(6);expect(p.slice(0,3).map(p=>p.z1)).toEqual(p.slice(3).map(p=>p.z1));
});
it('edits count, proportions and materials without changing opening controls',()=>{
 const f=openingForm(door);expect(f.data.doorPanelCount).toBe(2);
 expect(f.toPatch({doorPanel1Material:'solid',doorPanel0Height:2})).toEqual({panels:[{height:2,material:'solid'},{height:1,material:'solid'}]});
 expect(f.toPatch({doorPanelCount:0})).toEqual({panels:undefined});
});

it('keeps frame color separate from glass and rejects unsafe CSS',()=>{
 const draw=(frameColor:string)=>openingSolids({...door,frameColor},{color:'#555',amount:1},(x,y)=>({x,y}),100).filter(p=>p.kind==='panel');
 expect(draw('#805020').every(p=>p.frameColor==='#805020')).toBe(true);
 expect(draw('red; display:none').every(p=>p.frameColor===undefined)).toBe(true);
});

it.each([false, true])('does not subdivide a shutter on a door (glazed=%s)', (glazed) => {
 for (const style of ['roll', 'swing'] as const) {
  const solids = openingSolids({...door, glazed}, {color:'#555', amount:0,
   shutter:{style, amount:0.5}}, (x,y)=>({x,y}), 100).filter(p=>p.kind==='panel');
  const shutters = solids.slice(2);
  expect(shutters).toHaveLength(style === 'roll' ? 1 : 2);
  expect(shutters.every(p=>p.glazed === false && !p.framed)).toBe(true);
  expect(solids.slice(0,2).map(p=>p.glazed)).toEqual([false,true]);
 }
});
