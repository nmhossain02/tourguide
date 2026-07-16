from sqlite3 import connect

def list_orders(database="shop.db"):
    return connect(database).execute("select id, total from orders").fetchall()
