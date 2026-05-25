import type { DbId } from "@shared/contracts/api-contracts";

type Row = Record<string, unknown> & { id?: DbId; reservation_id?: DbId };
type RowLike = { id?: DbId; reservation_id?: DbId };

function keyOf(row: RowLike) {
  return String(row.id ?? row.reservation_id ?? "");
}

export function mergeRealtimeRow<T extends RowLike>(
  rows: T[],
  update?: RowLike
): T[] {
  const key = update ? keyOf(update) : "";
  if (!key) return rows;

  let found = false;
  const merged = rows.map((row) => {
    if (keyOf(row) !== key) return row;
    found = true;
    return { ...row, ...update } as T;
  });

  return found ? merged : [{ ...update } as T, ...merged];
}

export function mergeRealtimeRows<T extends RowLike>(
  rows: T[],
  updates: Record<string, Row>
): T[] {
  return Object.values(updates).reduce(
    (current, update) => mergeRealtimeRow(current, update),
    rows
  );
}

export function mergeListingRows<
  T extends RowLike & { status?: unknown; remaining_quantity?: unknown }
>(
  rows: T[],
  updates: Record<string, Row>
): T[] {
  return Object.values(updates).reduce((current, update) => {
    const merged = mergeRealtimeRow(current, update);
    return merged.filter((listing) => {
      if (listing.status === "deleted") return false;
      return true;
    });
  }, rows);
}
