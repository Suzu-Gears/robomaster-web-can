import { buildMotorCommand } from "../communication/command";
import {
  detectMotorFromFrameId,
  isSelectedMotorFeedbackFrame,
} from "../communication/feedback";
import { MOTOR_SPECS, parseFeedback } from "../motor";
import { PIDController } from "../pid";
import { serialManager } from "../serial";
import { parseSLCANLine } from "../slcan";
import { type AppState } from "../state/app";
import { fromRPM, fromTicks, type VelocityUnit } from "./units";
import { formatMonitorTimestamp } from "../ui/time";

const INTERNAL_VELOCITY_UNIT = "rads" as const;
const TICKS_PER_REVOLUTION = 8192;
const INTERNAL_VELOCITY_GAIN_SCALE_FROM = (unit: VelocityUnit): number =>
  fromRPM(1, unit) / fromRPM(1, INTERNAL_VELOCITY_UNIT);
const convertSpeedToPositionDerivative = (speedRpm: number, positionUnit: AppState["positionUnit"]): number =>
  fromTicks((speedRpm / 60) * TICKS_PER_REVOLUTION, positionUnit);
const getPositionDerivativeOverride = (state: AppState): number | undefined => {
  if (state.positionDerivativeSource !== "speedFeedback") return undefined;
  // 微分項は d(error)/dt を使うため、d(measured)/dt の速度FBを使う場合は符号を反転する。
  return -convertSpeedToPositionDerivative(state.latestFeedback?.speed || 0, state.positionUnit);
};

type ControlLoopDeps = {
  speedPid: PIDController;
  posPid: PIDController;
  cascadePosPid: PIDController;
  engageEmergencyStop: () => void;
  activateEmergencyStop: (message: string) => void;
  appendLog: (message: string) => void;
};

export async function sendMotorCommandCycle(
  state: AppState,
  deps: ControlLoopDeps,
): Promise<void> {
  if (!serialManager.port) return;

  const now = performance.now();
  if (state.lastControlTime > 0) {
    const dt_ms = now - state.lastControlTime;
    state.executionIntervals.push(dt_ms);
    if (state.executionIntervals.length > 10) state.executionIntervals.shift();

    if (state.executionIntervals.length === 10) {
      const avgInterval =
        state.executionIntervals.reduce((a, b) => a + b) / 10;
      const currentHz = 1000 / avgInterval;
      const targetHz = 1000 / state.sendInterval;

      // 更新を安定させるため、10回に1回だけ代入する（数値の激しい変化を抑える）
      if (state.executionIntervals.length % 10 === 0) {
        state.actualFreq = currentHz;
      }

      if (Math.abs(currentHz - targetHz) > targetHz * 0.2) {
        state.frequencyErrorCount++;
        if (state.frequencyErrorCount >= 5) {
          deps.engageEmergencyStop();
          deps.appendLog(
            `警告: 制御周波数の異常が連続発生しました (実測: ${state.actualFreq.toFixed(1)}Hz, 目標: ${targetHz.toFixed(1)}Hz)。安全のため停止します。`,
          );
          state.frequencyErrorCount = 0;
          return;
        }
      } else {
        state.frequencyErrorCount = 0;
      }
    }
  }
  state.lastControlTime = now;

  let target = 0;
  const type = state.selectedMotorType;
  const motorId = state.selectedMotorId;

  if (state.isEmergencyStopActive) {
    target = 0;
    if (state.latestFeedback) {
      state.targetPositionTicks = state.latestFeedback.accumPosition;
    }
  } else if (motorId === null || isNaN(motorId)) {
    target = 0;
  } else if (state.mode === "direct") {
    target = state.directTargetValue;
  } else if (state.mode === "speed") {
    const interval = state.sendInterval;
    deps.speedPid.setGains(
      state.speedPidGains.kp,
      state.speedPidGains.ki,
      state.speedPidGains.kd,
      state.speedPidGains.iLimit,
    );
    state.commandCurrentmA = deps.speedPid.calculate(
      fromRPM(state.targetVelocityRPM, state.velocityUnit),
      fromRPM(state.latestFeedback?.speed || 0, state.velocityUnit),
      interval / 1000,
    ) + state.speedFeedforwardmA;
    target = state.commandCurrentmA;
  } else if (state.mode === "position") {
    const interval = state.sendInterval;
    const derivativeOverride = getPositionDerivativeOverride(state);
    deps.posPid.setGains(
      state.posPidGains.kp,
      state.posPidGains.ki,
      state.posPidGains.kd,
      state.posPidGains.iLimit,
    );
    state.commandCurrentmA = deps.posPid.calculate(
      fromTicks(state.targetPositionTicks, state.positionUnit),
      fromTicks(state.latestFeedback?.accumPosition || 0, state.positionUnit),
      interval / 1000,
      derivativeOverride,
    ) + state.posFeedforwardmA;
    target = state.commandCurrentmA;
  } else if (state.mode === "cascade") {
    const interval = state.sendInterval;
    const derivativeOverride = getPositionDerivativeOverride(state);
    const innerGainScale = INTERNAL_VELOCITY_GAIN_SCALE_FROM(state.velocityUnit);
    deps.cascadePosPid.setGains(
      state.cascadePosPidGains.kp,
      state.cascadePosPidGains.ki,
      state.cascadePosPidGains.kd,
      state.cascadePosPidGains.iLimit,
    );
    deps.speedPid.setGains(
      state.speedPidGains.kp * innerGainScale,
      state.speedPidGains.ki * innerGainScale,
      state.speedPidGains.kd * innerGainScale,
      state.speedPidGains.iLimit * innerGainScale,
    );
    const targetVelocityRPM = deps.cascadePosPid.calculate(
      fromTicks(state.targetPositionTicks, state.positionUnit),
      fromTicks(state.latestFeedback?.accumPosition || 0, state.positionUnit),
      interval / 1000,
      derivativeOverride,
    );
    const targetVelocityRadPerSec = fromRPM(targetVelocityRPM, INTERNAL_VELOCITY_UNIT);
    state.cascadeTargetVelocityRPM = targetVelocityRPM;
    state.commandCurrentmA = deps.speedPid.calculate(
      targetVelocityRadPerSec,
      fromRPM(state.latestFeedback?.speed || 0, INTERNAL_VELOCITY_UNIT),
      interval / 1000,
      // カスケード時の最終電流指令は内側速度ループの出力に対してFFを適用する。
    ) + state.speedFeedforwardmA;
    target = state.commandCurrentmA;
  }

  const spec = MOTOR_SPECS[type];
  const limit = state.safetyLimit / 100;
  const clamped = Math.max(spec.min * limit, Math.min(spec.max * limit, target));

  if (motorId !== null) {
    await serialManager.write(
      buildMotorCommand(type, motorId, clamped, spec.rawScale),
    );
  }
  if (state.mode === "direct") {
    state.directCommandDisplay = clamped;
  }
}

/**
 * 通信途絶したIDをクリーンアップし、必要に応じて非常停止を発動する。
 */
export function cleanupDetectedMotors(state: AppState, onMotorLost: (type: string, id: number) => void): void {
  const now = performance.now();
  const timeout = 1000;

  for (const type of ["C6x0", "GM6020"] as const) {
    const ids = state.detectedIds[type];
    for (const [idStr, lastTime] of Object.entries(ids)) {
      const id = Number(idStr);
      if (now - lastTime > timeout) {
        delete ids[id];
        onMotorLost(type, id);
      }
    }
  }
}

let lastMonitorUpdate = 0;

export function processIncomingLine(
  line: string,
  state: AppState,
  appendLog?: (msg: string) => void,
  onNewIdDetected?: () => void,
): void {
  const frame = parseSLCANLine(line);
  if (!frame) return;

  const now = performance.now();
  if (state.mode === "direct" && now - lastMonitorUpdate > 16) {
    const timeString = formatMonitorTimestamp();
    state.monitorFrames.unshift({
      time: timeString,
      id: frame.id.toString(16).toUpperCase(),
      dlc: frame.dlc,
      data: frame.data,
    });
    if (state.monitorFrames.length > 50) state.monitorFrames.length = 50;
    lastMonitorUpdate = now;
  }

  const detectedMotor = detectMotorFromFrameId(frame.id);
  if (detectedMotor) {
    const isNew = !(detectedMotor.id in state.detectedIds[detectedMotor.type]);
    state.detectedIds[detectedMotor.type][detectedMotor.id] = now;
    if (isNew) {
      appendLog?.(`モーター検出: ${detectedMotor.type} (ID: ${detectedMotor.id})`);
      onNewIdDetected?.();
    }
  }

  const motorId = state.selectedMotorId;
  if (
    motorId !== null &&
    isSelectedMotorFeedbackFrame(
      frame.id,
      state.selectedMotorType,
      motorId,
    )
  ) {
    const fb = parseFeedback(
      frame.data,
      state.prevPositionRaw,
      state.accumPosition,
    );
    if (fb) {
      state.latestFeedback = fb;
      state.prevPositionRaw = fb.position;
      state.accumPosition = fb.accumPosition;
    }
  }
}
