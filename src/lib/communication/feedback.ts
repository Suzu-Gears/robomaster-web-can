import { type MotorType, getRxId } from "../motor";

export type DetectedMotor =
  | { type: "C6x0"; id: number }
  | { type: "GM6020"; id: number };

export function detectMotorFromFrameId(frameId: number): DetectedMotor | null {
  if (frameId >= 0x201 && frameId <= 0x20b) {
    if (frameId <= 0x208) return { type: "C6x0", id: frameId - 0x200 };
    return { type: "GM6020", id: frameId - 0x204 };
  }
  return null;
}

export function isSelectedMotorFeedbackFrame(
  frameId: number,
  motorType: MotorType,
  motorId: number,
): boolean {
  if (isNaN(motorId)) return false;
  return frameId === getRxId(motorType, motorId);
}
