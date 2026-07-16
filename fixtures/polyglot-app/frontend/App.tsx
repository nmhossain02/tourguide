export function App() {
  return <button onClick={() => fetch("/api/orders")}>Load orders</button>;
}
