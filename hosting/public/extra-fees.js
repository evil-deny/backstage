export const EXTRA_FEES=[{id:'fee-rent',key:'rent',name:'租金位子'},{id:'fee-electricity',key:'electricity',name:'電費'}];
export const isExtraFee=item=>EXTRA_FEES.some(f=>f.id===item.id);
const invalid=()=>{throw Object.assign(Error('額外費用請輸入 0 至 100000000 元的整數金額，每項固定一筆'),{status:400});};
export function extraFeeItems(amounts){
 return EXTRA_FEES.flatMap(f=>{const raw=amounts[f.key];if(raw===''||raw===undefined)return [];const price=Number(raw);if(!Number.isSafeInteger(price)||price<0||price>100000000)invalid();return price?[{id:f.id,name:f.name,price,qty:1,unit:'筆',category:'額外費用',custom:true,fee:true}]:[];});
}
export function validateExtraFee(item){
 const f=EXTRA_FEES.find(f=>f.id===item.id);if(!f)return null;
 if(item.name!==f.name||item.qty!==1||item.unit!=='筆'||!Number.isSafeInteger(item.price)||item.price<=0||item.price>100000000)invalid();
 return f;
}
