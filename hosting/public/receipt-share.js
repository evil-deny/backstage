export function receiptShareGroups(order,categoryFor=()=>undefined){
 const groups=[{title:'福緣訂單明細',label:'訂單明細',items:order.items}];
 const twoDay=order.items.filter(item=>!item.custom&&String(item.category??categoryFor(item.id)??'').startsWith('兩天一次'));
 if(twoDay.length)groups.push({title:'兩天一次檢貨單',label:'兩天一次檢貨單',items:twoDay});
 return groups;
}

export function receiptCategory(item,categoryFor=()=>undefined){
 if(item.fee||['fee-rent','fee-electricity'].includes(item.id))return '額外費用';
 const category=item.category??(!item.custom?categoryFor(item.id):undefined);
 if(category&&category!=='已刪除')return String(category).startsWith('兩天一次')?'兩天一次':String(category);
 return item.custom?'客製化品項':'未分類';
}
export function receiptSections(items,categoryFor=()=>undefined){
 const sections=new Map();items.forEach((item,index)=>{const category=receiptCategory(item,categoryFor);if(!sections.has(category))sections.set(category,{category,entries:[]});sections.get(category).entries.push({item,index});});
 const order=['公司庫存','兩天一次','每日叫貨','額外費用'];const rank=c=>order.includes(c)?order.indexOf(c):order.length;
 return [...sections.values()].sort((a,b)=>rank(a.category)-rank(b.category));
}
