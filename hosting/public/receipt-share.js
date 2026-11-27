export function receiptShareGroups(order,categoryFor=()=>undefined){
 const groups=[{title:'福緣訂單明細',label:'訂單明細',items:order.items}];
 const twoDay=order.items.filter(item=>!item.custom&&String(item.category??categoryFor(item.id)??'').startsWith('兩天一次'));
 if(twoDay.length)groups.push({title:'兩天一次檢貨單',label:'兩天一次檢貨單',items:twoDay});
 return groups;
}
