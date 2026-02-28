export type VelocityUnit = "RPM" | "rps" | "rads";
export type PositionUnit = "tick" | "deg" | "rad";
const TICKS_PER_REVOLUTION = 8192;

export function toRPM(val: number, unit: VelocityUnit): number {
  if (unit === "rps") return val * 60;
  if (unit === "rads") return (val * 60) / (2 * Math.PI);
  return val;
}

export function fromRPM(val: number, unit: VelocityUnit): number {
  if (unit === "rps") return val / 60;
  if (unit === "rads") return (val / 60) * (2 * Math.PI);
  return val;
}

export function toTicks(val: number, unit: PositionUnit): number {
  if (unit === "deg") return (val * TICKS_PER_REVOLUTION) / 360;
  if (unit === "rad") return (val * TICKS_PER_REVOLUTION) / (2 * Math.PI);
  return val;
}

export function fromTicks(val: number, unit: PositionUnit): number {
  if (unit === "deg") return (val * 360) / TICKS_PER_REVOLUTION;
  if (unit === "rad") return (val * (2 * Math.PI)) / TICKS_PER_REVOLUTION;
  return val;
}
