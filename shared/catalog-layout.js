// Visible P-numbers may change; product.id is the permanent order/inventory identity.
export function movedCatalog(products,ids,afterId){
 const selected=new Set(ids),moving=products.filter(p=>selected.has(p.id)),rest=products.filter(p=>!selected.has(p.id));
 if(!moving.length||moving.length!==selected.size||selected.size!==ids.length)throw Error('請選擇有效且不重複的商品');
 if(afterId!==null&&(selected.has(afterId)||!rest.some(p=>p.id===afterId)))throw Error('插入位置不能是已選商品，且必須仍在目錄中');
 const index=afterId===null?0:rest.findIndex(p=>p.id===afterId)+1;
 return [...rest.slice(0,index),...moving,...rest.slice(index)];
}
export const productCode=p=>p.code||(Number.isSafeInteger(p.displayNumber)?'P'+p.displayNumber:p.id);
