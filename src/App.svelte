<script lang="ts">
  import { onMount } from "svelte";

  import { Chart, registerables } from "chart.js";
  import { IconBrandGithub } from "@tabler/icons-svelte";
  import { PIDController } from "./lib/pid";
  import { isGmMotorType, MOTOR_SPECS, type MotorType } from "./lib/motor";
  import { buildMotorCommand } from "./lib/communication/command";
  import { serialManager } from "./lib/serial";
  import {
    initCharts,
    resetCharts,
    updateCharts,
    type AppMode,
  } from "./lib/ui/charts";
  import {
    fromRPM,
    fromTicks,
    toRPM,
    toTicks,
    type PositionUnit,
    type VelocityUnit,
  } from "./lib/control/units";
  import {
    INITIAL_CONTROL_VALUES,
    appState,
    appStateStore,
    rawState,
    triggerUiUpdate,
  } from "./lib/state/app";
  import {
    processIncomingLine,
    sendMotorCommandCycle,
    cleanupDetectedMotors,
  } from "./lib/control/control-loop";
  import Sidebar from "./lib/components/Sidebar.svelte";
  import Monitor from "./lib/components/Monitor.svelte";
  import {
    restartControlLoop,
    startRenderLoop,
    stopControlLoop,
  } from "./lib/control/timer";
  import { formatMonitorTimestamp } from "./lib/ui/time";

  Chart.register(...registerables);

  let speedPid: PIDController;
  let posPid: PIDController;
  let cascadePosPid: PIDController;

  function convertGainSet(gains: Record<string, number>, scale: number): void {
    gains.kp *= scale;
    gains.ki *= scale;
    gains.kd *= scale;
    gains.iLimit *= scale;
  }

  function formatVelocityUnit(unit: VelocityUnit): string {
    return unit === "rads" ? "rad/s" : unit;
  }

  function formatCascadeNumber(value: number): string {
    return Number.isFinite(value) ? value.toFixed(4) : "--";
  }
  const convertRPMToPositionUnitsPerSecond = (
    speedRpm: number,
    positionUnit: PositionUnit,
  ): number =>
    fromTicks(toTicks(fromRPM(speedRpm, "rads"), "rad"), positionUnit);
  const getMonitorSpeedFeedback = (
    speedRpm: number,
    positionUnit: PositionUnit,
    derivativeSource: "positionDiff" | "speedFeedback",
  ): number => {
    const feedback = convertRPMToPositionUnitsPerSecond(speedRpm, positionUnit);
    return derivativeSource === "speedFeedback" ? -feedback : feedback;
  };

  const CSV_DELIMITER = ", ";
  const joinCsv = (items: Array<number | string>): string =>
    items
      .map((v) => (typeof v === "number" ? formatCascadeNumber(v) : v))
      .join(CSV_DELIMITER);
  const splitCsv = (value: string): string[] =>
    value ? value.split(CSV_DELIMITER) : [];

  const speedInternalLabels = (unit: VelocityUnit): string =>
    `目標速度[${formatVelocityUnit(unit)}], 実速度[${formatVelocityUnit(unit)}], 速度誤差[${formatVelocityUnit(unit)}], dt[s], Kp, Ki, Kd, I-Limit, 積分値, 微分値[${formatVelocityUnit(unit)}/s], P, I, D, FF[mA], 出力[mA]`;

  const positionInternalLabels = (posUnit: PositionUnit): string =>
    `目標位置[${posUnit}], 実位置[${posUnit}], 位置誤差[${posUnit}], dt[s], Kp, Ki, Kd, I-Limit, 積分値, 微分値[${posUnit}/s], 速度FB[${posUnit}/s], P, I, D, FF[mA], 出力[mA]`;

  const cascadeInternalLabels = (
    posUnit: PositionUnit,
    velUnit: VelocityUnit,
  ): string =>
    `外側目標位置[${posUnit}], 外側実位置[${posUnit}], 外側誤差[${posUnit}], 外側dt[s], 外側Kp, 外側Ki, 外側Kd, 外側I-Limit, 外側積分値, 外側微分値[${posUnit}/s], 外側速度FB[${posUnit}/s], 外側P, 外側I, 外側D, 外側出力[${formatVelocityUnit(velUnit)}], 内側実速度[${formatVelocityUnit(velUnit)}], 内側誤差[${formatVelocityUnit(velUnit)}], 内側dt[s], 内側Kp, 内側Ki, 内側Kd, 内側I-Limit, 内側積分値, 内側微分値[${formatVelocityUnit(velUnit)}/s], 内側P, 内側I, 内側D, FF[mA], 最終出力[mA]`;

  $: internalValueHeaderLabels =
    $appStateStore.mode === "speed"
      ? speedInternalLabels($appStateStore.velocityUnit)
      : $appStateStore.mode === "position"
        ? positionInternalLabels($appStateStore.positionUnit)
        : $appStateStore.mode === "cascade"
          ? cascadeInternalLabels(
              $appStateStore.positionUnit,
              $appStateStore.velocityUnit,
            )
          : "";
  $: internalValueHeaderItems = splitCsv(internalValueHeaderLabels);

  function appendInternalValues(state = rawState): void {
    if (!state.latestFeedback) return;
    if (!["speed", "position", "cascade"].includes(state.mode)) return;
    const time = formatMonitorTimestamp();
    let labels = "";
    let values = "";
    if (state.mode === "speed") {
      const target = fromRPM(state.targetVelocityRPM, state.velocityUnit);
      const measured = fromRPM(state.latestFeedback.speed, state.velocityUnit);
      labels = speedInternalLabels(state.velocityUnit);
      values = joinCsv([
        target,
        measured,
        target - measured,
        speedPid.lastDt,
        state.speedPidGains.kp,
        state.speedPidGains.ki,
        state.speedPidGains.kd,
        state.speedPidGains.iLimit,
        speedPid.integral,
        speedPid.lastDerivative,
        speedPid.lastP,
        speedPid.lastI,
        speedPid.lastD,
        state.speedFeedforwardmA,
        state.commandCurrentmA,
      ]);
    } else if (state.mode === "position") {
      const target = fromTicks(state.targetPositionTicks, state.positionUnit);
      const measured = fromTicks(
        state.latestFeedback.accumPosition,
        state.positionUnit,
      );
      const speedFeedback = getMonitorSpeedFeedback(
        state.latestFeedback.speed,
        state.positionUnit,
        state.positionDerivativeSource,
      );
      labels = positionInternalLabels(state.positionUnit);
      values = joinCsv([
        target,
        measured,
        target - measured,
        posPid.lastDt,
        state.posPidGains.kp,
        state.posPidGains.ki,
        state.posPidGains.kd,
        state.posPidGains.iLimit,
        posPid.integral,
        posPid.lastDerivative,
        speedFeedback,
        posPid.lastP,
        posPid.lastI,
        posPid.lastD,
        state.posFeedforwardmA,
        state.commandCurrentmA,
      ]);
    } else {
      const targetPos = fromTicks(
        state.targetPositionTicks,
        state.positionUnit,
      );
      const measuredPos = fromTicks(
        state.latestFeedback.accumPosition,
        state.positionUnit,
      );
      const speedFeedback = getMonitorSpeedFeedback(
        state.latestFeedback.speed,
        state.positionUnit,
        state.positionDerivativeSource,
      );
      const measuredSpeed = fromRPM(
        state.latestFeedback.speed,
        state.velocityUnit,
      );
      const targetSpeed = fromRPM(
        state.cascadeTargetVelocityRPM,
        state.velocityUnit,
      );
      labels = cascadeInternalLabels(state.positionUnit, state.velocityUnit);
      values = joinCsv([
        targetPos,
        measuredPos,
        targetPos - measuredPos,
        cascadePosPid.lastDt,
        state.cascadePosPidGains.kp,
        state.cascadePosPidGains.ki,
        state.cascadePosPidGains.kd,
        state.cascadePosPidGains.iLimit,
        cascadePosPid.integral,
        cascadePosPid.lastDerivative,
        speedFeedback,
        cascadePosPid.lastP,
        cascadePosPid.lastI,
        cascadePosPid.lastD,
        targetSpeed,
        measuredSpeed,
        targetSpeed - measuredSpeed,
        speedPid.lastDt,
        speedPid.kp,
        speedPid.ki,
        speedPid.kd,
        speedPid.iLimit,
        speedPid.integral,
        speedPid.lastDerivative,
        speedPid.lastP,
        speedPid.lastI,
        speedPid.lastD,
        state.speedFeedforwardmA,
        state.commandCurrentmA,
      ]);
    }
    state.internalValueFrames.unshift({ time, labels, values });
    if (state.internalValueFrames.length > 50)
      state.internalValueFrames.length = 50;
  }

  function handleVelocityUnitChange(newUnit: VelocityUnit): void {
    const oldUnit = rawState.velocityUnit;
    if (oldUnit === newUnit) return;
    const scale = fromRPM(1, oldUnit) / fromRPM(1, newUnit);
    convertGainSet(rawState.speedPidGains, scale);
    rawState.speedSteps = rawState.speedSteps.map((v) =>
      fromRPM(toRPM(v, oldUnit), newUnit),
    );
    appState.velocityUnit = newUnit;
    resetCharts(rawState.charts);
  }

  function handlePositionUnitChange(newUnit: PositionUnit): void {
    const oldUnit = rawState.positionUnit;
    if (oldUnit === newUnit) return;
    const scale = fromTicks(1, oldUnit) / fromTicks(1, newUnit);
    convertGainSet(rawState.posPidGains, scale);
    convertGainSet(rawState.cascadePosPidGains, scale);
    rawState.posLimitMin = fromTicks(
      toTicks(rawState.posLimitMin, oldUnit),
      newUnit,
    );
    rawState.posLimitMax = fromTicks(
      toTicks(rawState.posLimitMax, oldUnit),
      newUnit,
    );
    rawState.posSteps = rawState.posSteps.map((v) =>
      fromTicks(toTicks(v, oldUnit), newUnit),
    );
    appState.positionUnit = newUnit;
    resetCharts(rawState.charts);
  }

  function appendLog(message: string): void {
    const time = formatMonitorTimestamp();
    rawState.logEntries.unshift({ time, message });
    if (rawState.logEntries.length > 100) rawState.logEntries.length = 100;
    triggerUiUpdate();
  }

  function activateEmergencyStop(message: string): void {
    appState.isEmergencyStopActive = true;
    appState.directTargetValue = 0;
    appState.directCommandDisplay = 0;
    appState.targetVelocityRPM = 0;
    appState.cascadeTargetVelocityRPM = 0;
    if (speedPid) speedPid.reset();
    if (posPid) posPid.reset();
    if (cascadePosPid) cascadePosPid.reset();
    appendLog(message);
  }

  function clearEmergencyStop(message: string): void {
    appState.isEmergencyStopActive = false;
    appendLog(message);
  }

  function switchMode(mode: AppMode): void {
    engageEmergencyStop();
    appState.mode = mode;
    rawState.internalValueFrames = [];
    rawState.displayInternalValueFrames = [];
    appState.isInternalMonitorPaused = false;
  }

  const sendMotorCommand = () =>
    sendMotorCommandCycle(rawState, {
      speedPid,
      posPid,
      cascadePosPid,
      engageEmergencyStop,
      activateEmergencyStop,
      appendLog,
    });

  const handleLine = (line: string) =>
    processIncomingLine(line, rawState, appendLog, triggerUiUpdate);

  const stopSpecificMotor = async (type: MotorType, id: number) => {
    if (appState.isConnected && !isNaN(id)) {
      const spec = MOTOR_SPECS[type];
      await serialManager.write(buildMotorCommand(type, id, 0, spec.rawScale));
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  const handleEmergencyStop = () => {
    if (!appState.isEmergencyStopActive) {
      activateEmergencyStop("非常停止を実行しました。");
    } else {
      if (
        (appState.mode === "position" || appState.mode === "cascade") &&
        rawState.latestFeedback
      ) {
        const minTicks = toTicks(appState.posLimitMin, appState.positionUnit);
        const maxTicks = toTicks(appState.posLimitMax, appState.positionUnit);
        if (
          rawState.latestFeedback.accumPosition < minTicks ||
          rawState.latestFeedback.accumPosition > maxTicks
        ) {
          const msg = `警告: 現在位置 (${fromTicks(rawState.latestFeedback.accumPosition, appState.positionUnit).toFixed(2)}${appState.positionUnit}) が設定範囲外です。\n位置リセットを行うか、手動で範囲内に戻すまで解除できません。`;
          alert(msg);
          appendLog(msg);
          return;
        }
      }
      clearEmergencyStop("非常停止を解除しました。");
    }
  };

  const engageEmergencyStop = () => {
    if (appState.isEmergencyStopActive) return;
    activateEmergencyStop("モード切替に伴い、非常停止を実行しました。");
  };

  async function connect() {
    appendLog("シリアルポートへの接続を試みています...");
    try {
      if (await serialManager.connect()) {
        appendLog("接続成功。CANバスを開いています (1Mbps)...");
        await serialManager.write("C\rS8\rO\r");
        appState.isConnected = true;
        activateEmergencyStop(
          "接続しました。安全のため非常停止を有効にしました。解除するまで出力は行われません。",
        );

        rawState.detectedIds.C6x0 = {};
        rawState.detectedIds.GM6020 = {};
        triggerUiUpdate();

        rawState.lastControlTime = 0;
        rawState.controlLoopStartTime = performance.now();
        rawState.executionIntervals = Array(10).fill(appState.sendInterval);
        rawState.frequencyErrorCount = 0;
        rawState.controlTimer = restartControlLoop(
          rawState.controlTimer,
          appState.sendInterval,
          sendMotorCommand,
        );

        serialManager.readLoop(handleLine);

        let lastTelemetryTime = 0;
        let lastMonitorTime = 0;

        startRenderLoop(
          () => Boolean(serialManager.port),
          (t) => {
            const config = rawState.uiConfig;

            // 1. 通信断のチェック (高頻度)
            cleanupDetectedMotors(rawState, (type, id) => {
              if (
                id === rawState.selectedMotorId &&
                ((type === "C6x0" &&
                  !isGmMotorType(rawState.selectedMotorType)) ||
                  (type === "GM6020" &&
                    isGmMotorType(rawState.selectedMotorType)))
              ) {
                activateEmergencyStop(
                  `警告: 制御中のモーター (${rawState.selectedMotorType} ID: ${id}) の通信が途絶しました。安全のため出力を停止します。`,
                );
              }
            });

            // 2. 数値テレメトリ更新
            if (t - lastTelemetryTime > config.telemetryUpdateMs) {
              rawState.displayFeedback = rawState.latestFeedback
                ? { ...rawState.latestFeedback }
                : null;
              rawState.displayFreq = rawState.actualFreq;
              if (!rawState.isInternalMonitorPaused) {
                appendInternalValues();
                rawState.displayInternalValueFrames = [
                  ...rawState.internalValueFrames,
                ];
              }
              triggerUiUpdate();
              lastTelemetryTime = t;
            }

            // 3. 受信モニター更新
            if (t - lastMonitorTime > config.monitorUpdateMs) {
              rawState.displayMonitorFrames = [...rawState.monitorFrames];
              triggerUiUpdate();
              lastMonitorTime = t;
            }

            // 4. グラフ更新
            if (
              t - rawState.lastDrawTime > config.chartUpdateMs &&
              rawState.latestFeedback
            ) {
              updateCharts(rawState.charts, rawState.latestFeedback, {
                mode: rawState.mode,
                currentUnit: rawState.velocityUnit,
                currentPosUnit: rawState.positionUnit,
                targetVelocityRPM:
                  rawState.mode === "cascade"
                    ? rawState.cascadeTargetVelocityRPM
                    : rawState.targetVelocityRPM,
                targetPositionTicks: rawState.targetPositionTicks,
                speedPidIntegral: speedPid.integral,
                posPidIntegral:
                  rawState.mode === "cascade"
                    ? cascadePosPid.integral
                    : posPid.integral,
                commandCurrentmA: rawState.commandCurrentmA,
              });
              rawState.lastDrawTime = t;
            }
          },
        );
      }
    } catch (e) {
      appendLog(`接続エラー: ${e}`);
    }
  }

  async function disconnect() {
    activateEmergencyStop("切断のため、非常停止を有効にしました。");
    const type = appState.selectedMotorType;
    const motorId = appState.selectedMotorId;
    if (appState.isConnected && motorId !== null) {
      const spec = MOTOR_SPECS[type];
      await serialManager.write(
        buildMotorCommand(type, motorId, 0, spec.rawScale),
      );
      await new Promise((r) => setTimeout(r, 50));
    }
    rawState.controlTimer = stopControlLoop(rawState.controlTimer);
    await serialManager.write("C\r");
    await serialManager.disconnect();
    appState.isConnected = false;
    rawState.prevPositionRaw = null;
    rawState.accumPosition = 0;
    rawState.targetPositionTicks = 0;
    appendLog("切断しました。位置情報をリセットしました。");
  }

  onMount(() => {
    speedPid = new PIDController(
      INITIAL_CONTROL_VALUES.speedPidGains.kp,
      INITIAL_CONTROL_VALUES.speedPidGains.ki,
      INITIAL_CONTROL_VALUES.speedPidGains.kd,
      INITIAL_CONTROL_VALUES.speedPidGains.iLimit,
    );
    posPid = new PIDController(
      INITIAL_CONTROL_VALUES.posPidGains.kp,
      INITIAL_CONTROL_VALUES.posPidGains.ki,
      INITIAL_CONTROL_VALUES.posPidGains.kd,
      INITIAL_CONTROL_VALUES.posPidGains.iLimit,
    );
    cascadePosPid = new PIDController(
      INITIAL_CONTROL_VALUES.cascadePosPidGains.kp,
      INITIAL_CONTROL_VALUES.cascadePosPidGains.ki,
      INITIAL_CONTROL_VALUES.cascadePosPidGains.kd,
      INITIAL_CONTROL_VALUES.cascadePosPidGains.iLimit,
    );

    rawState.charts = initCharts(document);

    let lastSelectedId = appState.selectedMotorId;
    let lastSelectedType = appState.selectedMotorType;

    const unsubscribe = appStateStore.subscribe(($state) => {
      if (
        $state.selectedMotorId !== lastSelectedId ||
        $state.selectedMotorType !== lastSelectedType
      ) {
        if (lastSelectedId !== null) {
          void stopSpecificMotor(lastSelectedType, lastSelectedId);
        }
        engageEmergencyStop();
        lastSelectedId = $state.selectedMotorId;
        lastSelectedType = $state.selectedMotorType;
      }
    });

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "hidden" &&
        rawState.isConnected &&
        !rawState.isEmergencyStopActive
      ) {
        activateEmergencyStop(
          "タブ切替を検出したため、非常停止を実行しました。",
        );
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  });
</script>

<svelte:window
  on:click={(e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === "connectBtn") connect();
    if (target.id === "disconnectBtn") disconnect();
  }}
/>

<main>
  <header class="app-header">
    <div class="header-title-area">
      <h1>RoboMaster CAN コントローラー</h1>
      <a
        href="https://github.com/Suzu-Gears/robomaster-web-can"
        target="_blank"
        rel="noopener noreferrer"
        class="github-link"
        title="GitHub repository"
      >
        <IconBrandGithub size={24} />
      </a>
    </div>
    <div class="mode-selector">
      <button
        class="mode-btn"
        class:active={$appStateStore.mode === "direct"}
        on:click={() => switchMode("direct")}>直接制御</button
      >
      <button
        class="mode-btn"
        class:active={$appStateStore.mode === "speed"}
        on:click={() => switchMode("speed")}>速度PID制御</button
      >
      <button
        class="mode-btn"
        class:active={$appStateStore.mode === "position"}
        on:click={() => switchMode("position")}>位置PID制御</button
      >
      <button
        class="mode-btn"
        class:active={$appStateStore.mode === "cascade"}
        on:click={() => switchMode("cascade")}>カスケードPID制御</button
      >
    </div>
  </header>

  <div class="app-container">
    <aside class="sidebar">
      <Sidebar />
    </aside>

    <div class="main-content">
      <div class="mode-view" class:hidden={$appStateStore.mode !== "direct"}>
        <section class="graph-panel">
          <div class="charts-container">
            <div class="chart-wrapper"><canvas id="posChart"></canvas></div>
            <div class="chart-wrapper"><canvas id="speedChart"></canvas></div>
            <div class="chart-wrapper"><canvas id="currentChart"></canvas></div>
          </div>
          <div class="slider-row" style="margin-top: 1.5rem;">
            <label for="directTargetValue"
              >指令値: <span>{$appStateStore.directCommandDisplay}</span> mA</label
            >
            <input
              type="range"
              id="directTargetValue"
              min="-10000"
              max="10000"
              bind:value={appState.directTargetValue}
              disabled={!$appStateStore.isConnected ||
                $appStateStore.isEmergencyStopActive}
            />
          </div>
          <button
            class="danger"
            class:active={$appStateStore.isEmergencyStopActive}
            disabled={!$appStateStore.isConnected}
            on:click={handleEmergencyStop}
            style="width: 100%; margin-top: 0.5rem;"
            >{$appStateStore.isEmergencyStopActive
              ? "非常停止解除"
              : "非常停止 (出力0)"}</button
          >
        </section>
        <div class="monitor-grid"><Monitor /></div>
      </div>

      <div class="mode-view" class:hidden={$appStateStore.mode !== "speed"}>
        <section class="graph-panel">
          <div class="charts-container">
            <div class="chart-wrapper">
              <canvas id="pidVelocityChart"></canvas>
            </div>
            <div class="chart-wrapper">
              <canvas id="pidIntegratorChart"></canvas>
            </div>
            <div class="chart-wrapper">
              <canvas id="pidCurrentChart"></canvas>
            </div>
          </div>
          <div class="slider-row" style="margin-top: 1.5rem;">
            <label for="targetSlider"
              >目標速度: <span
                >{fromRPM(
                  $appStateStore.targetVelocityRPM,
                  $appStateStore.velocityUnit,
                ).toFixed(2)}</span
              >
              {formatVelocityUnit($appStateStore.velocityUnit)}</label
            >
            <input
              type="range"
              id="targetSlider"
              min={-fromRPM(20000, $appStateStore.velocityUnit)}
              max={fromRPM(20000, $appStateStore.velocityUnit)}
              value={fromRPM(
                $appStateStore.targetVelocityRPM,
                $appStateStore.velocityUnit,
              )}
              on:input={(e) =>
                (appState.targetVelocityRPM = toRPM(
                  parseFloat(e.currentTarget.value),
                  $appStateStore.velocityUnit,
                ))}
              disabled={!$appStateStore.isConnected ||
                $appStateStore.isEmergencyStopActive}
            />
          </div>
          <button
            class="danger"
            class:active={$appStateStore.isEmergencyStopActive}
            disabled={!$appStateStore.isConnected}
            on:click={handleEmergencyStop}
            style="width: 100%; margin-top: 0.5rem;"
            >{$appStateStore.isEmergencyStopActive
              ? "非常停止解除"
              : "非常停止 (出力0)"}</button
          >
        </section>
        <div class="pid-controls-grid">
          <section class="gain-panel">
            <h2>速度PID ゲイン設定</h2>
            <div class="unit-selector-in-gain">
              表示単位:
              {#each ["RPM", "rps", "rads"] as unit}
                <label
                  ><input
                    type="radio"
                    name="velocityUnit"
                    value={unit}
                    checked={$appStateStore.velocityUnit === unit}
                    on:change={() =>
                      handleVelocityUnitChange(unit as VelocityUnit)}
                  />
                  {formatVelocityUnit(unit as VelocityUnit)}</label
                >
              {/each}
            </div>
            <div class="gain-grid">
              <div class="control-row">
                <label for="gain_kp">Kp</label>
                <input
                  type="number"
                  id="gain_kp"
                  bind:value={appState.speedPidGains.kp}
                  step="0.1"
                />
              </div>
              <div class="control-row">
                <label for="gain_ki">Ki</label>
                <input
                  type="number"
                  id="gain_ki"
                  bind:value={appState.speedPidGains.ki}
                  step="0.01"
                />
              </div>
              <div class="control-row">
                <label for="gain_kd">Kd</label>
                <input
                  type="number"
                  id="gain_kd"
                  bind:value={appState.speedPidGains.kd}
                  step="0.1"
                />
              </div>
              <div class="control-row">
                <label for="gain_iLimit">I-Limit</label>
                <input
                  type="number"
                  id="gain_iLimit"
                  bind:value={appState.speedPidGains.iLimit}
                  step="100"
                />
              </div>
              <div class="control-row">
                <label for="speed_feedforward">FF (mA)</label>
                <input
                  type="number"
                  id="speed_feedforward"
                  bind:value={appState.speedFeedforwardmA}
                  step="10"
                />
              </div>
            </div>
            <button class="secondary" on:click={() => speedPid.reset()}
              >積分器リセット</button
            >
          </section>
          <section class="step-panel">
            <h2>ステップ入力 (速度)</h2>
            <div class="step-list">
              {#each $appStateStore.speedSteps as step, i}
                <div class="step-row">
                  <input type="number" bind:value={appState.speedSteps[i]} />
                  <button
                    class="secondary"
                    on:click={() =>
                      (appState.targetVelocityRPM = toRPM(
                        rawState.speedSteps[i],
                        $appStateStore.velocityUnit,
                      ))}
                    disabled={!$appStateStore.isConnected ||
                      $appStateStore.isEmergencyStopActive}>適用</button
                  >
                </div>
              {/each}
            </div>
          </section>
        </div>
        <div class="monitor-grid">
          <section class="monitor-panel">
            <div class="monitor-header-row">
              <h2>内部値モニター</h2>
              <button
                class="secondary"
                on:click={() =>
                  (appState.isInternalMonitorPaused =
                    !rawState.isInternalMonitorPaused)}
                >{$appStateStore.isInternalMonitorPaused
                  ? "再開"
                  : "一時停止"}</button
              >
            </div>
            <div class="table-container internal-table-container">
              <table class="internal-monitor-table">
                <thead>
                  <tr>
                    <th class="col-time">時刻</th>
                    {#each internalValueHeaderItems as item}
                      <th class="col-item">{item}</th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each $appStateStore.displayInternalValueFrames as frame}
                    <tr>
                      <td>{frame.time}</td>
                      {#each splitCsv(frame.values) as value}
                        <td class="col-item">{value}</td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      <div
        class="mode-view"
        class:hidden={!["position", "cascade"].includes($appStateStore.mode)}
      >
        <section class="graph-panel">
          <div class="charts-container">
            <div class="chart-wrapper">
              <canvas id="posTargetChart"></canvas>
            </div>
            <div class="chart-wrapper">
              <canvas id="posIntegratorChart"></canvas>
            </div>
            <div class="chart-wrapper">
              <canvas id="posCurrentChart"></canvas>
            </div>
          </div>
          <div class="slider-row" style="margin-top: 1.5rem;">
            <label
              >目標位置: <span
                >{fromTicks(
                  $appStateStore.targetPositionTicks,
                  $appStateStore.positionUnit,
                ).toFixed(2)}</span
              >
              {$appStateStore.positionUnit}
              <div class="pos-limits">
                L: <input type="number" bind:value={appState.posLimitMin} />
                U: <input type="number" bind:value={appState.posLimitMax} />
              </div></label
            >
            <input
              type="range"
              min={$appStateStore.posLimitMin}
              max={$appStateStore.posLimitMax}
              step="0.1"
              value={fromTicks(
                $appStateStore.targetPositionTicks,
                $appStateStore.positionUnit,
              )}
              on:input={(e) =>
                (appState.targetPositionTicks = toTicks(
                  parseFloat(e.currentTarget.value),
                  $appStateStore.positionUnit,
                ))}
              disabled={!$appStateStore.isConnected ||
                $appStateStore.isEmergencyStopActive}
            />
          </div>
          <button
            class="danger"
            class:active={$appStateStore.isEmergencyStopActive}
            disabled={!$appStateStore.isConnected}
            on:click={handleEmergencyStop}
            style="width: 100%; margin-top: 0.5rem;"
            >{$appStateStore.isEmergencyStopActive
              ? "非常停止解除"
              : "非常停止 (出力0)"}</button
          >
        </section>
        <div class="pid-controls-grid">
          {#if $appStateStore.mode === "cascade"}
            <section class="gain-panel">
              <h2>内側 速度PID ゲイン設定</h2>
              <div class="unit-selector-in-gain">
                表示単位:
                {#each ["RPM", "rps", "rads"] as unit}
                  <label
                    ><input
                      type="radio"
                      name="cascadeVelocityUnit"
                      value={unit}
                      checked={$appStateStore.velocityUnit === unit}
                      on:change={() =>
                        handleVelocityUnitChange(unit as VelocityUnit)}
                    />
                    {formatVelocityUnit(unit as VelocityUnit)}</label
                  >
                {/each}
              </div>
              <div class="gain-grid">
                <div class="control-row">
                  <label for="cascade_gain_kp">Kp</label>
                  <input
                    type="number"
                    id="cascade_gain_kp"
                    bind:value={appState.speedPidGains.kp}
                    step="0.1"
                  />
                </div>
                <div class="control-row">
                  <label for="cascade_gain_ki">Ki</label>
                  <input
                    type="number"
                    id="cascade_gain_ki"
                    bind:value={appState.speedPidGains.ki}
                    step="0.01"
                  />
                </div>
                <div class="control-row">
                  <label for="cascade_gain_kd">Kd</label>
                  <input
                    type="number"
                    id="cascade_gain_kd"
                    bind:value={appState.speedPidGains.kd}
                    step="0.1"
                  />
                </div>
                <div class="control-row">
                  <label for="cascade_gain_iLimit">I-Limit</label>
                  <input
                    type="number"
                    id="cascade_gain_iLimit"
                    bind:value={appState.speedPidGains.iLimit}
                    step="100"
                  />
                </div>
                <div class="control-row">
                  <label for="cascade_speed_feedforward">FF (mA)</label>
                  <input
                    type="number"
                    id="cascade_speed_feedforward"
                    bind:value={appState.speedFeedforwardmA}
                    step="10"
                  />
                </div>
              </div>
              <button class="secondary" on:click={() => speedPid.reset()}
                >積分器リセット</button
              >
            </section>
          {/if}
          <section class="gain-panel">
            <h2>
              {$appStateStore.mode === "cascade"
                ? "カスケード位置PID ゲイン設定"
                : "位置PID ゲイン設定"}
            </h2>
            <div class="unit-selector-in-gain">
              微分項の速度入力:
              <label
                ><input
                  type="radio"
                  name="positionDerivativeSource"
                  value="positionDiff"
                  checked={$appStateStore.positionDerivativeSource ===
                    "positionDiff"}
                  on:change={() =>
                    (appState.positionDerivativeSource = "positionDiff")}
                />
                位置変化の微分</label
              >
              <label
                ><input
                  type="radio"
                  name="positionDerivativeSource"
                  value="speedFeedback"
                  checked={$appStateStore.positionDerivativeSource ===
                    "speedFeedback"}
                  on:change={() =>
                    (appState.positionDerivativeSource = "speedFeedback")}
                />
                速度フィードバック</label
              >
            </div>
            <div class="unit-selector-in-gain">
              表示単位:
              {#each ["rad", "deg", "tick"] as unit}
                <label
                  ><input
                    type="radio"
                    name="posUnit"
                    value={unit}
                    checked={$appStateStore.positionUnit === unit}
                    on:change={() =>
                      handlePositionUnitChange(unit as PositionUnit)}
                  />
                  {unit}</label
                >
              {/each}
            </div>
            <div class="gain-grid">
              <div class="control-row">
                <label for="pos_gain_kp">Kp</label>
                {#if $appStateStore.mode === "cascade"}
                  <input
                    type="number"
                    id="pos_gain_kp"
                    bind:value={appState.cascadePosPidGains.kp}
                    step="1"
                  />
                {:else}
                  <input
                    type="number"
                    id="pos_gain_kp"
                    bind:value={appState.posPidGains.kp}
                    step="1"
                  />
                {/if}
              </div>
              <div class="control-row">
                <label for="pos_gain_ki">Ki</label>
                {#if $appStateStore.mode === "cascade"}
                  <input
                    type="number"
                    id="pos_gain_ki"
                    bind:value={appState.cascadePosPidGains.ki}
                    step="0.01"
                  />
                {:else}
                  <input
                    type="number"
                    id="pos_gain_ki"
                    bind:value={appState.posPidGains.ki}
                    step="0.01"
                  />
                {/if}
              </div>
              <div class="control-row">
                <label for="pos_gain_kd">Kd</label>
                {#if $appStateStore.mode === "cascade"}
                  <input
                    type="number"
                    id="pos_gain_kd"
                    bind:value={appState.cascadePosPidGains.kd}
                    step="0.1"
                  />
                {:else}
                  <input
                    type="number"
                    id="pos_gain_kd"
                    bind:value={appState.posPidGains.kd}
                    step="0.1"
                  />
                {/if}
              </div>
              <div class="control-row">
                <label for="pos_gain_iLimit">I-Limit</label>
                {#if $appStateStore.mode === "cascade"}
                  <input
                    type="number"
                    id="pos_gain_iLimit"
                    bind:value={appState.cascadePosPidGains.iLimit}
                    step="1"
                  />
                {:else}
                  <input
                    type="number"
                    id="pos_gain_iLimit"
                    bind:value={appState.posPidGains.iLimit}
                    step="1"
                  />
                {/if}
              </div>
              {#if $appStateStore.mode !== "cascade"}
                <div class="control-row">
                  <label for="pos_feedforward">FF (mA)</label>
                  <input
                    type="number"
                    id="pos_feedforward"
                    bind:value={appState.posFeedforwardmA}
                    step="10"
                  />
                </div>
              {/if}
            </div>
            <div class="button-group" style="gap: 0.5rem; margin-top: 1rem;">
              <button
                class="secondary"
                on:click={() =>
                  $appStateStore.mode === "cascade"
                    ? cascadePosPid.reset()
                    : posPid.reset()}>積分器リセット</button
              >
              <button
                class="secondary"
                on:click={() => {
                  appState.accumPosition = 0;
                  appState.targetPositionTicks = 0;
                  appendLog("位置情報をゼロリセットしました。");
                }}>位置リセット</button
              >
            </div>
          </section>
          {#if $appStateStore.mode === "cascade"}
            <section class="step-panel cascade-internal-panel">
              <h2>内部値 (カスケード)</h2>
              <div class="formula-row">
                <span>目標位置</span>
                <span
                  >{formatCascadeNumber(
                    fromTicks(
                      $appStateStore.targetPositionTicks,
                      $appStateStore.positionUnit,
                    ),
                  )}
                  {$appStateStore.positionUnit} = {formatCascadeNumber(
                    fromTicks($appStateStore.targetPositionTicks, "rad"),
                  )} rad</span
                >
              </div>
              <div class="formula-row">
                <span>実位置</span>
                <span
                  >{formatCascadeNumber(
                    fromTicks(
                      $appStateStore.latestFeedback?.accumPosition || 0,
                      $appStateStore.positionUnit,
                    ),
                  )}
                  {$appStateStore.positionUnit} = {formatCascadeNumber(
                    fromTicks(
                      $appStateStore.latestFeedback?.accumPosition || 0,
                      "rad",
                    ),
                  )} rad</span
                >
              </div>
              <div class="formula-row">
                <span>位置誤差</span>
                <span
                  >{formatCascadeNumber(
                    fromTicks(
                      $appStateStore.targetPositionTicks -
                        ($appStateStore.latestFeedback?.accumPosition || 0),
                      $appStateStore.positionUnit,
                    ),
                  )}
                  {$appStateStore.positionUnit} = {formatCascadeNumber(
                    fromTicks(
                      $appStateStore.targetPositionTicks -
                        ($appStateStore.latestFeedback?.accumPosition || 0),
                      "rad",
                    ),
                  )} rad</span
                >
              </div>
              <div class="formula-row">
                <span>外側PID出力</span>
                <span
                  >{formatCascadeNumber(
                    fromRPM(
                      $appStateStore.cascadeTargetVelocityRPM,
                      $appStateStore.velocityUnit,
                    ),
                  )}
                  {formatVelocityUnit($appStateStore.velocityUnit)} = {formatCascadeNumber(
                    fromRPM($appStateStore.cascadeTargetVelocityRPM, "rads"),
                  )} rad/s</span
                >
              </div>
              <div class="formula-row">
                <span>実速度</span>
                <span
                  >{formatCascadeNumber(
                    fromRPM(
                      $appStateStore.latestFeedback?.speed || 0,
                      $appStateStore.velocityUnit,
                    ),
                  )}
                  {formatVelocityUnit($appStateStore.velocityUnit)} = {formatCascadeNumber(
                    fromRPM($appStateStore.latestFeedback?.speed || 0, "rads"),
                  )} rad/s</span
                >
              </div>
              <div class="formula-row">
                <span>内側速度誤差</span>
                <span
                  >{formatCascadeNumber(
                    fromRPM(
                      $appStateStore.cascadeTargetVelocityRPM -
                        ($appStateStore.latestFeedback?.speed || 0),
                      $appStateStore.velocityUnit,
                    ),
                  )}
                  {formatVelocityUnit($appStateStore.velocityUnit)} = {formatCascadeNumber(
                    fromRPM(
                      $appStateStore.cascadeTargetVelocityRPM -
                        ($appStateStore.latestFeedback?.speed || 0),
                      "rads",
                    ),
                  )} rad/s</span
                >
              </div>
              <div class="formula-row">
                <span>最終電流指令</span>
                <span
                  >{formatCascadeNumber($appStateStore.commandCurrentmA)} mA</span
                >
              </div>
            </section>
          {/if}
          <section class="step-panel">
            <h2>ステップ入力 (位置)</h2>
            <div class="step-list">
              {#each $appStateStore.posSteps as step, i}
                <div class="step-row">
                  <input type="number" bind:value={appState.posSteps[i]} />
                  <button
                    class="secondary"
                    on:click={() =>
                      (appState.targetPositionTicks = toTicks(
                        rawState.posSteps[i],
                        $appStateStore.positionUnit,
                      ))}
                    disabled={!$appStateStore.isConnected ||
                      $appStateStore.isEmergencyStopActive ||
                      step < $appStateStore.posLimitMin ||
                      step > $appStateStore.posLimitMax}>適用</button
                  >
                </div>
              {/each}
            </div>
          </section>
        </div>
        <div class="monitor-grid">
          <section class="monitor-panel">
            <div class="monitor-header-row">
              <h2>内部値モニター</h2>
              <button
                class="secondary"
                on:click={() =>
                  (appState.isInternalMonitorPaused =
                    !rawState.isInternalMonitorPaused)}
                >{$appStateStore.isInternalMonitorPaused
                  ? "再開"
                  : "一時停止"}</button
              >
            </div>
            <div class="table-container internal-table-container">
              <table class="internal-monitor-table">
                <thead>
                  <tr>
                    <th class="col-time">時刻</th>
                    {#each internalValueHeaderItems as item}
                      <th class="col-item">{item}</th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each $appStateStore.displayInternalValueFrames as frame}
                    <tr>
                      <td>{frame.time}</td>
                      {#each splitCsv(frame.values) as value}
                        <td class="col-item">{value}</td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</main>

<style>
  :global(:root) {
    --primary-color: #007bff;
    --success-color: #28a745;
    --danger-color: #dc3545;
    --secondary-color: #6c757d;
    --bg-color: #f0f2f5;
    --panel-bg: #ffffff;
    --sidebar-width: 300px;
  }
  :global(body) {
    background-color: var(--bg-color);
    margin: 0;
    color: #333;
    font-family: "Segoe UI", Roboto, sans-serif;
  }
  main {
    max-width: 1400px;
    margin: 0 auto;
    padding: 1rem;
  }
  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid #ddd;
  }
  .header-title-area {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }
  .github-link {
    color: #333;
    display: flex;
    align-items: center;
    transition: color 0.2s;
    text-decoration: none;
  }
  .github-link:hover {
    color: var(--primary-color);
  }
  h1 {
    margin: 0;
    font-size: 1.5rem;
  }
  h2 {
    font-size: 1.1rem;
    margin-top: 0;
    margin-bottom: 1rem;
    border-left: 4px solid var(--primary-color);
    padding-left: 0.5rem;
  }
  .mode-selector {
    display: flex;
    gap: 0.5rem;
  }
  .mode-btn {
    padding: 0.5rem 1.5rem;
    border: 1px solid #ced4da;
    background: #fff;
    cursor: pointer;
    font-weight: 600;
    border-radius: 4px;
  }
  .mode-btn.active {
    background: var(--primary-color);
    color: #fff;
    border-color: var(--primary-color);
  }
  .app-container {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
  }
  .sidebar {
    width: var(--sidebar-width);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .main-content {
    flex-grow: 1;
    min-width: 0;
    overflow: hidden;
  }
  section {
    padding: 1.2rem;
    border-radius: 8px;
    background: var(--panel-bg);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
  }
  .mode-view {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .hidden {
    display: none !important;
  }
  .control-row {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .control-row label {
    font-size: 0.85rem;
    font-weight: 600;
  }
  .slider-row {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .slider-row label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .pos-limits {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.8rem;
  }
  .pos-limits input {
    width: 60px;
    padding: 0.2rem;
  }
  .graph-panel {
    overflow-x: auto;
  }
  .charts-container {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    height: 250px;
    margin-bottom: 1rem;
    min-width: 900px;
  }
  .chart-wrapper {
    position: relative;
    height: 100%;
  }
  .pid-controls-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  .gain-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.8rem;
    margin-bottom: 1rem;
  }
  .step-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .step-row {
    display: flex;
    gap: 0.5rem;
  }
  .step-row input {
    flex: 1;
    min-width: 0;
    padding: 0.3rem;
  }
  .step-row button {
    flex-shrink: 0;
  }
  .cascade-internal-panel {
    background: #f8f9fa;
    border: 1px solid #e3e6ea;
    border-radius: 8px;
    padding: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .formula-row {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    font-size: 0.78rem;
  }
  .formula-row span:last-child {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas,
      "Liberation Mono", monospace;
    text-align: right;
    word-break: break-word;
  }
  .monitor-panel {
    overflow-x: auto;
  }
  .monitor-header-row {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    align-items: center;
  }
  .monitor-header-row h2 {
    margin-bottom: 0;
  }
  .table-container {
    min-width: 800px;
    height: 150px;
    overflow-x: auto;
    overflow-y: auto;
    font-size: 0.8rem;
    border: 1px solid #eee;
  }
  .internal-table-container {
    min-width: 900px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  .internal-monitor-table {
    table-layout: auto;
    width: max-content;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas,
      "Liberation Mono", monospace;
  }
  .internal-monitor-table .col-time {
    min-width: 140px;
  }
  .internal-monitor-table .col-item {
    min-width: 120px;
  }
  th,
  td {
    padding: 0.4rem;
    text-align: left;
    border-bottom: 1px solid #f0f0f0;
    vertical-align: top;
  }
  .internal-monitor-table th,
  .internal-monitor-table td {
    white-space: nowrap;
    overflow: visible;
    text-overflow: clip;
  }
  button {
    padding: 0.6rem;
    border-radius: 4px;
    border: 1px solid #ced4da;
    background: #fff;
    cursor: pointer;
    font-weight: 600;
  }
  button.danger {
    background: var(--danger-color);
    color: #fff;
    border: none;
    padding: 1.2rem 0.6rem;
  }
  button.danger.active {
    background: #8b0000;
  }
  button.secondary {
    background: var(--secondary-color);
    color: #fff;
    border: none;
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
