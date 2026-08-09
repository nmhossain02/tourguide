import { useState } from "react";

export interface AppProps {
  apiBase?: string;
}

export function App({ apiBase = "" }: AppProps) {
  const [orders, setOrders] = useState<Array<{ id: number; total: number }>>([]);
  return <main><button onClick={async () => setOrders(await (await fetch(`${apiBase}/api/orders`)).json())}>Load orders</button><output>{orders.map((order) => `$${order.total}`).join(", ")}</output></main>;
}
