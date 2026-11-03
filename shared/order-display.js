// Display only: API writes and stored order IDs always use the original ID.
export function orderLabel(id){const value=String(id??'');const uuid=value.match(/^FY-([a-f0-9]{8})-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);return uuid?'FY-'+uuid[1].toUpperCase():value;}
export const sourceLabel=channel=>channel==='order'?'員工開單':'顧客訂購';
export const sourceClass=channel=>channel==='order'?'staff':'customer';
