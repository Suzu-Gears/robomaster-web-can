import { type MotorFeedback } from "../motor";
import { fromRPM, fromTicks, type PositionUnit, type VelocityUnit } from "../control/units";

type FeedbackDisplayElements = {
  tempValue: HTMLElement;
  currentSpeedDisplay: HTMLElement;
  currentValue: HTMLElement;
  currentPosDisplay: HTMLElement;
};

export function renderFeedbackDisplay(
  elements: FeedbackDisplayElements,
  feedback: MotorFeedback,
  currentUnit: VelocityUnit,
  currentPosUnit: PositionUnit,
): void {
  elements.tempValue.textContent = feedback.temp.toString();
  elements.currentSpeedDisplay.textContent = fromRPM(
    feedback.speed,
    currentUnit,
  ).toFixed(2);
  elements.currentValue.textContent = feedback.current.toString();
  elements.currentPosDisplay.textContent = fromTicks(
    feedback.accumPosition,
    currentPosUnit,
  ).toFixed(2);
}
