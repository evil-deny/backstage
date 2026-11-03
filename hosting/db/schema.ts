import {sqliteTable,text,integer,check} from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';
export const inventory=sqliteTable('inventory',{
 id:text('id').primaryKey(),body:text('body').notNull(),stock:integer('stock'),price:integer('price').notNull(),orderPrice:integer('order_price'),
 orderVisible:integer('order_visible').notNull(),customerVisible:integer('customer_visible').notNull(),revision:integer('revision').notNull(),
},t=>[check('stock_nonnegative',sql`${t.stock} IS NULL OR ${t.stock} >= 0`),check('price_nonnegative',sql`${t.price} >= 0`),check('order_price_nonnegative',sql`${t.orderPrice} IS NULL OR ${t.orderPrice} >= 0`)]);
export const orders=sqliteTable('order_records',{id:text('id').primaryKey(),requestId:text('request_id').notNull().unique(),body:text('body').notNull(),revision:integer('revision').notNull()});
export const guards=sqliteTable('mutation_guards',{id:text('id').primaryKey(),ok:integer('ok').notNull()},t=>[check('mutation_must_succeed',sql`${t.ok} = 1`)]);
// These grants delegate the existing Sites identity to the same owner's GitHub
// Pages interface. They are not passwords or an alternative identity provider.
export const apiGrants=sqliteTable('api_grants',{hash:text('hash').primaryKey(),expires:integer('expires').notNull()});
export const connectionTickets=sqliteTable('connection_tickets',{hash:text('hash').primaryKey(),challenge:text('challenge').notNull(),expires:integer('expires').notNull()});
