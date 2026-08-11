create table if not exists orders (id integer primary key, total integer not null);
create table if not exists audit_events (id integer primary key, order_id integer references orders(id), event text not null);
