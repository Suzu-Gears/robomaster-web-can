export type ControlLoopElements = {
  modeDirect: HTMLButtonElement;
  modeSpeed: HTMLButtonElement;
  modePosition: HTMLButtonElement;
  viewDirect: HTMLElement;
  viewSpeed: HTMLElement;
  viewPosition: HTMLElement;
  connectBtn: HTMLButtonElement;
  disconnectBtn: HTMLButtonElement;
  status: HTMLElement;
  sendInterval: HTMLInputElement;
  actualFreq: HTMLElement;
  motorType: HTMLSelectElement;
  motorId: HTMLSelectElement;
  emergencyStop: HTMLButtonElement;
  emergencyStopSpeed: HTMLButtonElement;
  emergencyStopPos: HTMLButtonElement;
  directTargetValue: HTMLInputElement;
  directCommandDisplay: HTMLElement;
  directUnitDisplay: HTMLElement;
  log: HTMLElement;
  clearLog: HTMLButtonElement;
  gainKp: HTMLInputElement;
  gainKi: HTMLInputElement;
  gainKd: HTMLInputElement;
  gainILimit: HTMLInputElement;
  resetSpeedPID: HTMLButtonElement;
  targetSlider: HTMLInputElement;
  targetDisplay: HTMLElement;
  gainPosKp: HTMLInputElement;
  gainPosKi: HTMLInputElement;
  gainPosKd: HTMLInputElement;
  gainPosILimit: HTMLInputElement;
  resetPosPID: HTMLButtonElement;
  zeroPosition: HTMLButtonElement;
  safetyLimit: HTMLInputElement;
  posTargetSlider: HTMLInputElement;
  posTargetDisplay: HTMLElement;
  posLimitMin: HTMLInputElement;
  posLimitMax: HTMLInputElement;
  messageList: HTMLElement;
};

type BindableElementRefs = {
  sendInterval: HTMLInputElement;
  actualFreq: HTMLElement;
  motorType: HTMLSelectElement;
  motorId: HTMLSelectElement;
  safetyLimit: HTMLInputElement;
  directTargetValue: HTMLInputElement;
  directCommandDisplay: HTMLElement;
  messageList: HTMLElement;
  gainKp: HTMLInputElement;
  gainKi: HTMLInputElement;
  gainKd: HTMLInputElement;
  gainILimit: HTMLInputElement;
  targetSlider: HTMLInputElement;
  gainPosKp: HTMLInputElement;
  gainPosKi: HTMLInputElement;
  gainPosKd: HTMLInputElement;
  gainPosILimit: HTMLInputElement;
  posTargetSlider: HTMLInputElement;
  posTargetDisplay: HTMLElement;
};

const getById = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Required element not found: #${id}`);
  }
  return element as T;
};

export const collectControlLoopElements = (refs: BindableElementRefs): ControlLoopElements => ({
  modeDirect: getById<HTMLButtonElement>("modeDirect"),
  modeSpeed: getById<HTMLButtonElement>("modeSpeed"),
  modePosition: getById<HTMLButtonElement>("modePosition"),
  viewDirect: getById<HTMLElement>("viewDirect"),
  viewSpeed: getById<HTMLElement>("viewSpeed"),
  viewPosition: getById<HTMLElement>("viewPosition"),
  connectBtn: getById<HTMLButtonElement>("connectBtn"),
  disconnectBtn: getById<HTMLButtonElement>("disconnectBtn"),
  status: getById<HTMLElement>("status"),
  motorType: refs.motorType,
  motorId: refs.motorId,
  sendInterval: refs.sendInterval,
  actualFreq: refs.actualFreq,
  safetyLimit: refs.safetyLimit,
  emergencyStop: getById<HTMLButtonElement>("emergencyStop"),
  emergencyStopSpeed: getById<HTMLButtonElement>("emergencyStopSpeed"),
  emergencyStopPos: getById<HTMLButtonElement>("emergencyStopPos"),
  directTargetValue: refs.directTargetValue,
  directCommandDisplay: refs.directCommandDisplay,
  directUnitDisplay: getById<HTMLElement>("directUnitDisplay"),
  messageList: refs.messageList,
  log: getById<HTMLElement>("serialLog"),
  clearLog: getById<HTMLButtonElement>("clearLog"),
  gainKp: refs.gainKp,
  gainKi: refs.gainKi,
  gainKd: refs.gainKd,
  gainILimit: refs.gainILimit,
  resetSpeedPID: getById<HTMLButtonElement>("resetSpeedPID"),
  targetSlider: refs.targetSlider,
  targetDisplay: getById<HTMLElement>("targetDisplay"),
  gainPosKp: refs.gainPosKp,
  gainPosKi: refs.gainPosKi,
  gainPosKd: refs.gainPosKd,
  gainPosILimit: refs.gainPosILimit,
  resetPosPID: getById<HTMLButtonElement>("resetPosPID"),
  zeroPosition: getById<HTMLButtonElement>("zeroPosition"),
  posTargetSlider: refs.posTargetSlider,
  posTargetDisplay: refs.posTargetDisplay,
  posLimitMin: getById<HTMLInputElement>("posLimitMin"),
  posLimitMax: getById<HTMLInputElement>("posLimitMax"),
});
