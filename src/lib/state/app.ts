import type { MotorFeedback, MotorType } from "../motor";
import type { PositionUnit, VelocityUnit } from "../control/units";
import type { AppMode } from "../ui/charts";
import type { Chart } from "chart.js";
import { writable } from "svelte/store";

export type MonitorFrame = { time: string; id: string; dlc: number; data: string };
export type InternalValueFrame = { time: string; labels: string; values: string };

export type UIConfig = {
  telemetryUpdateMs: number; // 数値フィードバック、実周波数
  monitorUpdateMs: number;   // 受信モニター
  chartUpdateMs: number;     // グラフ
};

export type AppState = {
  isConnected: boolean;
  mode: AppMode;
  velocityUnit: VelocityUnit;
  positionUnit: PositionUnit;
  positionDerivativeSource: "positionDiff" | "speedFeedback";
  targetVelocityRPM: number;
  cascadeTargetVelocityRPM: number;
  targetPositionTicks: number;
  commandCurrentmA: number;
  latestFeedback: MotorFeedback | null;
  displayFeedback: MotorFeedback | null;
  prevPositionRaw: number | null;
  accumPosition: number;
  detectedIds: {
    C6x0: Record<number, number>;
    GM6020: Record<number, number>;
  };
  lastDrawTime: number;
  controlTimer: number | null;
  lastControlTime: number;
  controlLoopStartTime: number;
  executionIntervals: number[];
  frequencyErrorCount: number;
  charts: Record<string, Chart>;
  isEmergencyStopActive: boolean;

  sendInterval: number;
  actualFreq: number;
  displayFreq: number;
  selectedMotorType: MotorType;
  selectedMotorId: number | null;
  safetyLimit: number;
  directTargetValue: number;
  directCommandDisplay: number;
  posLimitMin: number;
  posLimitMax: number;

  speedPidGains: Record<string, number>;
  posPidGains: Record<string, number>;
  cascadePosPidGains: Record<string, number>;
  speedFeedforwardmA: number;
  posFeedforwardmA: number;
  speedSteps: number[];
  posSteps: number[];

  monitorFrames: Array<MonitorFrame>;
  displayMonitorFrames: Array<MonitorFrame>;
  internalValueFrames: Array<InternalValueFrame>;
  displayInternalValueFrames: Array<InternalValueFrame>;
  isInternalMonitorPaused: boolean;
  logEntries: Array<{ time: string; message: string }>;

  uiConfig: UIConfig;
};

export const INITIAL_CONTROL_VALUES = {
  posLimitMin: -200,
  posLimitMax: 200,
  speedPidGains: { kp: 1.0, ki: 1.0, kd: 0.0, iLimit: 5000 },
  posPidGains: { kp: 200, ki: 10, kd: 30.0, iLimit: 50 },
  cascadePosPidGains: { kp: 200, ki: 10.0, kd: 25.0, iLimit: 100 },
  speedSteps: [1000, -1000, 0, 0, 0],
  posSteps: [60, -60, 0, 0, 0],
} as const;

const initialData: AppState = {
  isConnected: false,
  mode: "direct",
  velocityUnit: "RPM",
  positionUnit: "rad",
  positionDerivativeSource: "positionDiff",
  targetVelocityRPM: 0,
  cascadeTargetVelocityRPM: 0,
  targetPositionTicks: 0,
  commandCurrentmA: 0,
  latestFeedback: null,
  displayFeedback: null,
  prevPositionRaw: null,
  accumPosition: 0,
  detectedIds: { C6x0: {}, GM6020: {} },
  lastDrawTime: 0,
  controlTimer: null,
  lastControlTime: 0,
  controlLoopStartTime: 0,
  executionIntervals: [],
  frequencyErrorCount: 0,
  charts: {},
  isEmergencyStopActive: false,
  sendInterval: 10,
  actualFreq: 0,
  displayFreq: 0,
  selectedMotorType: "C610",
  selectedMotorId: null,
  safetyLimit: 50,
  directTargetValue: 0,
  directCommandDisplay: 0,
  posLimitMin: INITIAL_CONTROL_VALUES.posLimitMin,
  posLimitMax: INITIAL_CONTROL_VALUES.posLimitMax,
  speedPidGains: { ...INITIAL_CONTROL_VALUES.speedPidGains },
  posPidGains: { ...INITIAL_CONTROL_VALUES.posPidGains },
  cascadePosPidGains: { ...INITIAL_CONTROL_VALUES.cascadePosPidGains },
  speedFeedforwardmA: 0,
  posFeedforwardmA: 0,
  speedSteps: [...INITIAL_CONTROL_VALUES.speedSteps],
  posSteps: [...INITIAL_CONTROL_VALUES.posSteps],
  monitorFrames: [],
  displayMonitorFrames: [],
  internalValueFrames: [],
  displayInternalValueFrames: [],
  isInternalMonitorPaused: false,
  logEntries: [],
  uiConfig: {
    telemetryUpdateMs: 100, // 10Hz
    monitorUpdateMs: 33,   // ~30Hz
    chartUpdateMs: 33,      // ~30Hz
  },
};

const internalState = { ...initialData };
const store = writable(internalState);
const { subscribe, set: setStore } = store;

let updateScheduled = false;
export const triggerUiUpdate = () => {
  if (updateScheduled) return;
  updateScheduled = true;
  requestAnimationFrame(() => {
    setStore(internalState);
    updateScheduled = false;
  });
};

const createSmartProxy = (target: any): any => {
  return new Proxy(target, {
    get(t, prop) {
      const val = Reflect.get(t, prop);
      if (val !== null && typeof val === "object") return createSmartProxy(val);
      return val;
    },
    set(t, prop, value) {
      let valToSet = value;
      if (typeof value === "string" && !isNaN(Number(value)) && value.trim() !== "") {
        valToSet = Number(value);
      }
      if (prop === "selectedMotorId" && value === "null") valToSet = null;

      const result = Reflect.set(t, prop, valToSet);
      triggerUiUpdate();
      return result;
    },
  });
};

export const appState = createSmartProxy(internalState) as AppState;
export const rawState = internalState;
export const appStateStore = { subscribe: store.subscribe };
