import html from '../../templates/employee.html?raw';
export const dynamic='force-dynamic';
export function GET(){return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY'}});}
