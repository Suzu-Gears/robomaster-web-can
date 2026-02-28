import { type MotorType, getTxInfo } from "../motor";
import { formatSLCAN } from "../slcan";

export function buildMotorCommand(type: MotorType, motorId: number, value: number, rawScale: number): string {
  const { txId, bufIdx } = getTxInfo(type, motorId);
  const rawVal = Math.round(value * rawScale);
  const rawHex = (rawVal & 0xffff)
    .toString(16)
    .padStart(4, "0")
    .toUpperCase();
  const dataArr = Array(8).fill("00");
  dataArr[bufIdx * 2] = rawHex.substring(0, 2);
  dataArr[bufIdx * 2 + 1] = rawHex.substring(2, 4);
  return formatSLCAN(txId, dataArr.join(""));
}
