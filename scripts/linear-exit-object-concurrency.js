'use strict';
// Bounded independent object work. A failure stops new work and drains every
// started task before the caller may clean up shared staging.
function limit(value=1){if(!Number.isInteger(value)||value<1||value>8)throw Error('OBJECT_CONCURRENCY_RANGE');return value;}
async function mapObjects(items,concurrency,visit){
 const count=limit(concurrency),result=new Array(items.length);let next=0,failed=false,firstError;
 async function worker(){while(!failed){const index=next++;if(index>=items.length)return;try{result[index]=await visit(items[index],index);}catch(error){if(!failed){failed=true;firstError=error;}}}}
 await Promise.all(Array.from({length:Math.min(count,items.length)},()=>worker()));
 if(failed)throw firstError;
 return result;
}
module.exports={limit,mapObjects};
