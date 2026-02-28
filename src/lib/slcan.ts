export interface CanFrame {
  type: "TX" | "RX";
  id: number;
  dlc: number;
  data: string;
}

export function parseSLCANLine(line: string): CanFrame | null {
  if (!line || line.length < 5) return null;
  const typeChar = line[0];
  if (typeChar === "t" || typeChar === "T") {
    const isExt = typeChar === "T";
    const idLen = isExt ? 8 : 3;
    const id = parseInt(line.substring(1, 1 + idLen), 16);
    const dlc = parseInt(line[1 + idLen], 16);
    const data = line.substring(2 + idLen, 2 + idLen + dlc * 2);
    return { type: "RX", id, dlc, data };
  }
  return null;
}

export function formatSLCAN(id: number, dataHex: string, extended: boolean = false): string {
  const typeChar = extended ? "T" : "t";
  const idStr = id.toString(16).toUpperCase().padStart(extended ? 8 : 3, "0");
  const dlc = Math.floor(dataHex.length / 2);
  return `${typeChar}${idStr}${dlc}${dataHex}\r`;
}
