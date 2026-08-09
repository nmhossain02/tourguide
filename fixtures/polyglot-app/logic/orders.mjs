export function orderSummary(orders) {
  return {
    count: orders.length,
    total: orders.reduce((sum, order) => sum + order.total, 0),
  };
}
