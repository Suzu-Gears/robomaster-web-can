export class PIDController {
  kp: number = 0;
  ki: number = 0;
  kd: number = 0;
  iLimit: number = 0;
  integral: number = 0;
  prevError: number = 0;
  lastDt: number = 0;
  lastError: number = 0;
  lastDerivative: number = 0;
  lastP: number = 0;
  lastI: number = 0;
  lastD: number = 0;
  lastOutput: number = 0;

  constructor(kp: number, ki: number, kd: number, iLimit: number) {
    this.setGains(kp, ki, kd, iLimit);
  }

  setGains(kp: number, ki: number, kd: number, iLimit: number) {
    this.kp = kp;
    this.ki = ki;
    this.kd = kd;
    this.iLimit = iLimit;
  }

  reset() {
    this.integral = 0;
    this.prevError = 0;
    this.lastDt = 0;
    this.lastError = 0;
    this.lastDerivative = 0;
    this.lastP = 0;
    this.lastI = 0;
    this.lastD = 0;
    this.lastOutput = 0;
  }

  calculate(
    setpoint: number,
    measured: number,
    dt: number,
    derivativeOverride?: number,
  ): number {
    if (dt <= 0) return 0;
    const error = setpoint - measured;
    this.integral += error * dt;
    if (this.integral > this.iLimit) this.integral = this.iLimit;
    if (this.integral < -this.iLimit) this.integral = -this.iLimit;
    const derivative = derivativeOverride ?? (error - this.prevError) / dt;
    this.prevError = error;
    const p = this.kp * error;
    const i = this.ki * this.integral;
    const d = this.kd * derivative;
    this.lastDt = dt;
    this.lastError = error;
    this.lastDerivative = derivative;
    this.lastP = p;
    this.lastI = i;
    this.lastD = d;
    this.lastOutput = p + i + d;
    return this.lastOutput;
  }
}
