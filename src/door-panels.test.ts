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
