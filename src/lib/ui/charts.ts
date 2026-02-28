import { Chart } from "chart.js";
import type { MotorFeedback } from "../motor";
import { fromRPM, fromTicks, type PositionUnit, type VelocityUnit } from "../control/units";

export type AppMode = "direct" | "speed" | "position" | "cascade";
const CURRENT_CHART_KEYS = ["current", "pidCurrent", "posCurrent"] as const;

export function initCharts(documentRef: Document): Record<string, Chart> {
  const charts: Record<string, Chart> = {};
  const common = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 as const },
    scales: { x: { display: false }, y: { beginAtZero: false } },
    elements: { point: { radius: 0 } },
  };

  charts.pos = new Chart(documentRef.getElementById("posChart") as HTMLCanvasElement, {
    type: "line",
    data: {
      labels: Array(50).fill(""),
      datasets: [{ label: "位置", data: Array(50).fill(0), borderColor: "#007bff", borderWidth: 2 }],
    },
    options: common,
  });
  charts.speed = new Chart(documentRef.getElementById("speedChart") as HTMLCanvasElement, {
    type: "line",
    data: {
      labels: Array(50).fill(""),
      datasets: [{ label: "速度", data: Array(50).fill(0), borderColor: "#28a745", borderWidth: 2 }],
    },
    options: common,
  });
  charts.current = new Chart(documentRef.getElementById("currentChart") as HTMLCanvasElement, {
    type: "line",
    data: {
      labels: Array(50).fill(""),
      datasets: [{ label: "電流", data: Array(50).fill(0), borderColor: "#dc3545", borderWidth: 2 }],
    },
    options: common,
  });

  charts.pidVelocity = new Chart(documentRef.getElementById("pidVelocityChart") as HTMLCanvasElement, {
    type: "line",
    data: {
      labels: Array(100).fill(""),
      datasets: [
        { label: "目標速度", data: Array(100).fill(0), borderColor: "#007bff", borderWidth: 1, borderDash: [5, 5] },
        { label: "実速度", data: Array(100).fill(0), borderColor: "#28a745", borderWidth: 2 },
      ],
    },
    options: common,
  });
  charts.pidIntegrator = new Chart(documentRef.getElementById("pidIntegratorChart") as HTMLCanvasElement, {
    type: "line",
    data: {
      labels: Array(100).fill(""),
      datasets: [{ label: "積分器", data: Array(100).fill(0), borderColor: "#ffc107", borderWidth: 2 }],
    },
    options: common,
  });
  charts.pidCurrent = new Chart(documentRef.getElementById("pidCurrentChart") as HTMLCanvasElement, {
    type: "line",
    data: {
      labels: Array(100).fill(""),
      datasets: [
        { label: "指令電流", data: Array(100).fill(0), borderColor: "#dc3545", borderWidth: 1, borderDash: [2, 2] },
        { label: "実電流", data: Array(100).fill(0), borderColor: "#6f42c1", borderWidth: 2 },
      ],
    },
    options: common,
  });

  charts.posTarget = new Chart(documentRef.getElementById("posTargetChart") as HTMLCanvasElement, {
    type: "line",
    data: {
      labels: Array(100).fill(""),
      datasets: [
        { label: "目標位置", data: Array(100).fill(0), borderColor: "#007bff", borderWidth: 1, borderDash: [5, 5] },
        { label: "実位置", data: Array(100).fill(0), borderColor: "#28a745", borderWidth: 2 },
      ],
    },
    options: common,
  });
  charts.posIntegrator = new Chart(documentRef.getElementById("posIntegratorChart") as HTMLCanvasElement, {
    type: "line",
    data: {
      labels: Array(100).fill(""),
      datasets: [{ label: "積分器", data: Array(100).fill(0), borderColor: "#ffc107", borderWidth: 2 }],
    },
    options: common,
  });
  charts.posCurrent = new Chart(documentRef.getElementById("posCurrentChart") as HTMLCanvasElement, {
    type: "line",
    data: {
      labels: Array(100).fill(""),
      datasets: [
        { label: "指令電流", data: Array(100).fill(0), borderColor: "#dc3545", borderWidth: 1, borderDash: [2, 2] },
        { label: "実電流", data: Array(100).fill(0), borderColor: "#6f42c1", borderWidth: 2 },
      ],
    },
    options: common,
  });

  return charts;
}

type UpdateChartsParams = {
  mode: AppMode;
  currentUnit: VelocityUnit;
  currentPosUnit: PositionUnit;
  targetVelocityRPM: number;
  targetPositionTicks: number;
  speedPidIntegral: number;
  posPidIntegral: number;
  commandCurrentmA: number;
};

export function updateCharts(
  charts: Record<string, Chart>,
  feedback: MotorFeedback,
  params: UpdateChartsParams,
): void {
  if (params.mode === "direct") {
    const ents: [string, number][] = [
      ["pos", feedback.position],
      ["speed", feedback.speed],
      ["current", feedback.current],
    ];
    ents.forEach(([k, v]) => {
      const c = charts[k];
      if (c) {
        c.data.datasets[0].data.push(v);
        c.data.datasets[0].data.shift();
        c.update("none");
      }
    });
    return;
  }

  if (params.mode === "speed") {
    const act = fromRPM(feedback.speed, params.currentUnit);
    const ref = fromRPM(params.targetVelocityRPM, params.currentUnit);
    charts.pidVelocity.data.datasets[0].data.push(ref);
    charts.pidVelocity.data.datasets[1].data.push(act);
    charts.pidIntegrator.data.datasets[0].data.push(params.speedPidIntegral);
    charts.pidCurrent.data.datasets[0].data.push(params.commandCurrentmA);
    charts.pidCurrent.data.datasets[1].data.push(feedback.current);
    ["pidVelocity", "pidIntegrator", "pidCurrent"].forEach((k) => {
      charts[k].data.datasets.forEach((ds) => ds.data.shift());
      charts[k].update("none");
    });
    return;
  }

  if (params.mode === "position") {
    const act = fromTicks(feedback.accumPosition, params.currentPosUnit);
    const ref = fromTicks(params.targetPositionTicks, params.currentPosUnit);
    charts.posTarget.data.datasets[0].data.push(ref);
    charts.posTarget.data.datasets[1].data.push(act);
    if (charts.posIntegrator.data.datasets.length !== 1) {
      charts.posIntegrator.data.datasets = [
        { label: "積分器", data: Array(100).fill(0), borderColor: "#ffc107", borderWidth: 2 },
      ];
    }
    charts.posIntegrator.data.datasets[0].data.push(params.posPidIntegral);
    charts.posCurrent.data.datasets[0].data.push(params.commandCurrentmA);
    charts.posCurrent.data.datasets[1].data.push(feedback.current);
    ["posTarget", "posIntegrator", "posCurrent"].forEach((k) => {
      charts[k].data.datasets.forEach((ds) => ds.data.shift());
      charts[k].update("none");
    });
    return;
  }

  if (params.mode === "cascade") {
    const posAct = fromTicks(feedback.accumPosition, params.currentPosUnit);
    const posRef = fromTicks(params.targetPositionTicks, params.currentPosUnit);
    const speedAct = fromRPM(feedback.speed, params.currentUnit);
    const speedRef = fromRPM(params.targetVelocityRPM, params.currentUnit);
    charts.posTarget.data.datasets[0].data.push(posRef);
    charts.posTarget.data.datasets[1].data.push(posAct);
    if (charts.posIntegrator.data.datasets.length !== 2) {
      charts.posIntegrator.data.datasets = [
        { label: "目標速度", data: Array(100).fill(0), borderColor: "#007bff", borderWidth: 1, borderDash: [5, 5] },
        { label: "実速度", data: Array(100).fill(0), borderColor: "#28a745", borderWidth: 2 },
      ];
    }
    charts.posIntegrator.data.datasets[0].data.push(speedRef);
    charts.posIntegrator.data.datasets[1].data.push(speedAct);
    charts.posCurrent.data.datasets[0].data.push(params.commandCurrentmA);
    charts.posCurrent.data.datasets[1].data.push(feedback.current);
    ["posTarget", "posIntegrator", "posCurrent"].forEach((k) => {
      charts[k].data.datasets.forEach((ds) => ds.data.shift());
      charts[k].update("none");
    });
    return;
  }
}

export function resetCharts(charts: Record<string, Chart>): void {
  Object.entries(charts).forEach(([chartKey, chart]) => {
    if (CURRENT_CHART_KEYS.includes(chartKey as (typeof CURRENT_CHART_KEYS)[number])) {
      return;
    }
    chart.data.datasets.forEach((dataset) => {
      if (Array.isArray(dataset.data)) {
        dataset.data = Array(dataset.data.length).fill(0);
      }
    });
    chart.update("none");
  });
}
