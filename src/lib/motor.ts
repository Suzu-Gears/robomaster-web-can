export type MotorType = 'C610' | 'C620' | 'GM6020_V' | 'GM6020_C';

export interface MotorSpec {
  name: string;
  unit: string;
  min: number;
  max: number;
  rawScale: number;
}

export const MOTOR_SPECS: Record<MotorType, MotorSpec> = {
  C610: { name: "C610", unit: "mA", min: -10000, max: 10000, rawScale: 1 },
  C620: { name: "C620", unit: "mA", min: -20000, max: 20000, rawScale: 16384 / 20000 },
  GM6020_V: { name: "GM6020 (V)", unit: "mV", min: -25000, max: 25000, rawScale: 1 },
  GM6020_C: { name: "GM6020 (C)", unit: "mA", min: -3000, max: 3000, rawScale: 16384 / 3000 },
};

export interface MotorFeedback {
  position: number;
  accumPosition: number;
  speed: number;
  current: number;
  temp: number;
}

export function isGmMotorType(type: MotorType): boolean {
  return type === "GM6020_V" || type === "GM6020_C";
}

export function getRxId(type: MotorType, id: number): number {
  if (type === 'C610' || type === 'C620') return 0x200 + id;
  return 0x204 + id;
}

export function getTxInfo(type: MotorType, id: number) {
  const bufIdx = id <= 4 ? id - 1 : id - 5;
  let txId = 0;
  if (type === "C610" || type === "C620") {
    txId = id <= 4 ? 0x200 : 0x1FF;
  } else {
    txId = id <= 4 ? 0x1FE : 0x2FE;
    if (type === "GM6020_V") txId++;
  }
  return { txId, bufIdx };
}

export function parseFeedback(dataHex: string, prevPositionRaw: number | null, prevAccumPosition: number): MotorFeedback | null {
  const match = dataHex.match(/.{1,2}/g);
  if (!match || match.length < 7) return null;
  const bytes = match.map((b) => parseInt(b, 16));

  const posRaw = (bytes[0] << 8) | bytes[1];
  let accumPosition = prevAccumPosition;
  if (prevPositionRaw !== null) {
    const delta = posRaw - prevPositionRaw;
    accumPosition += ((delta + 4096) & 8191) - 4096;
  } else {
    accumPosition = posRaw;
  }

  return {
    position: posRaw,
    accumPosition: accumPosition,
    speed: (((bytes[2] << 8) | bytes[3]) << 16) >> 16,
    current: (((bytes[4] << 8) | bytes[5]) << 16) >> 16,
    temp: bytes[6],
  };
}
