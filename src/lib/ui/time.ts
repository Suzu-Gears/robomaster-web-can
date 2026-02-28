const pad = (value: number, digits = 2): string => value.toString().padStart(digits, "0");

export const formatMonitorTimestamp = (date: Date = new Date()): string => {
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  const millis = pad(date.getMilliseconds(), 3);
  return `${hour}:${minute}:${second}.${millis}`;
};
