// Original order quantity stays immutable; shipment and picking quantities are separate.
export function shippedQuantity(item){return Number.isSafeInteger(item.shippedQty)?Math.max(0,Math.min(item.qty,item.shippedQty)):item.picked===false?0:item.qty;}
export function plannedQuantity(item){return Number.isSafeInteger(item.pickQty)?Math.max(0,Math.min(item.qty,item.pickQty)):item.picked?item.qty:0;}
