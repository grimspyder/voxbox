// Segment identity for the speed policy's "new road" reset.
//
// TomTom's snap-to-roads response gives a road name when it knows one and
// nothing when it does not (parking lots, driveways, freshly built roads). The
// name-plus-limit key is right when a name exists. Without one, a constant
// "unknown" would make every unnamed road in the state look like the same
// segment, and a limit resolved on one would be treated as still valid on the
// next — the policy would stay silent where it should announce a new limit.
//
// So an unnamed segment is identified by position on a ~100 m grid: close
// enough that a road change trips it, coarse enough that GPS jitter while
// stationary does not.
export type Point = [lon: number, lat: number];

const GRID = 3; // decimal places ≈ 111 m of latitude

export function segmentIdentity(
  state: string | null,
  road: string | null,
  limit: number,
  position: Point,
): string {
  const where = road ?? `unnamed@${position[1].toFixed(GRID)},${position[0].toFixed(GRID)}`;
  return `${state ?? '??'}|${where}|${limit}`;
}
