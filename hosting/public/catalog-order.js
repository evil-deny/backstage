// Shared catalog order for administration, wholesale and customer storefronts.
export const STORAGE_ORDER=['冷凍','冷藏','乾貨'];
export const TYPE_ORDER=['湯品/鍋物','丸類/火鍋料','素肉/調理肉品','海味/魚蝦類','糕餅/點心','麵食','小菜類','豆製品','蔬菜/菇類','醬料','素鬆/鬆類','包材/耗材','公司庫存其他','其他訂購品'];
const rank=(list,value)=>{const index=list.indexOf(value);return index<0?list.length:index;};
const compare=(a,b)=>String(a??'').localeCompare(String(b??''),'zh-Hant',{numeric:true});
export function catalogOrder(a,b){
 return rank(STORAGE_ORDER,a.storage)-rank(STORAGE_ORDER,b.storage)
  || compare(a.storage,b.storage)
  || rank(TYPE_ORDER,a.type)-rank(TYPE_ORDER,b.type)
  || compare(a.type,b.type)
  || compare(a.name,b.name)
  || compare(a.id,b.id);
}
