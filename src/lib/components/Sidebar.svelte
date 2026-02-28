<script lang="ts">
  import { appState, appStateStore } from "../state/app";
  import { isGmMotorType } from "../motor";
  import { fromRPM, fromTicks } from "../control/units";

  // IDの選択肢を計算 (Objectのキーを取得)
  // IDが新しく検出されても、現在の選択を維持しやすくするためにメモ化に近い形で動作
  $: currentMap = isGmMotorType($appStateStore.selectedMotorType)
    ? $appStateStore.detectedIds.GM6020
    : $appStateStore.detectedIds.C6x0;

  $: motorIds = Object.keys(currentMap)
    .map(Number)
    .sort((a, b) => a - b);

  function clearLog() {
    appState.logEntries = [];
    appState.monitorFrames = [];
  }

  function formatVelocityUnit(unit: "RPM" | "rps" | "rads"): string {
    return unit === "rads" ? "rad/s" : unit;
  }
</script>

<section class="connection-panel">
  <h2>1. 接続設定</h2>
  <div class="button-group">
    <button
      id="connectBtn"
      class="primary"
      disabled={$appStateStore.isConnected}>デバイスに接続 (1Mbps)</button
    >
    <button id="disconnectBtn" disabled={!$appStateStore.isConnected}
      >切断</button
    >
  </div>
  <div class="status-bar">
    状態:
    <span
      id="status"
      class={$appStateStore.isConnected ? "status-online" : "status-offline"}
      >{$appStateStore.isConnected ? "オンライン" : "オフライン"}</span
    >
  </div>
  <div class="control-row" style="margin-top: 0.8rem;">
    <label for="sendInterval">送信周期 (10-1000ms) / 実周波数:</label>
    <div style="display: flex; gap: 0.5rem; align-items: center;">
      <input
        type="number"
        id="sendInterval"
        min="10"
        max="1000"
        bind:value={appState.sendInterval}
        style="flex: 1;"
      />
      <span
        style="font-family: monospace; font-weight: bold; min-width: 60px; text-align: right;"
        ><span>{$appStateStore.displayFreq.toFixed(1)}</span> Hz</span
      >
    </div>
  </div>
</section>

<section class="motor-select-panel">
  <h2>2. モーター設定</h2>
  <div class="side-control-grid">
    <div class="control-row">
      <label for="motorType">種類:</label>
      <select id="motorType" bind:value={appState.selectedMotorType}>
        <option value="C610">C610 (電流)</option>
        <option value="C620">C620 (電流)</option>
        <option value="GM6020_V">GM6020 (電圧)</option>
        <option value="GM6020_C">GM6020 (電流)</option>
      </select>
    </div>
    <div class="control-row">
      <label for="motorId">ID:</label>
      <select id="motorId" bind:value={appState.selectedMotorId}>
        {#if motorIds.length === 0}
          <option value={null}>未検出</option>
        {:else}
          <option value={null} disabled>IDを選択してください</option>
          {#each motorIds as id}
            <option value={id}>{id}</option>
          {/each}
        {/if}
      </select>
    </div>
  </div>

  <div class="safety-row" style="margin-top: 1rem;">
    <label for="safetyLimit"
      >出力制限: <span>{$appStateStore.safetyLimit}</span>%</label
    >
    <input
      type="range"
      id="safetyLimit"
      min="0"
      max="100"
      bind:value={appState.safetyLimit}
    />
  </div>

  <div class="feedback-info">
    温度: <span>{$appStateStore.displayFeedback?.temp ?? "--"}</span> °C<br />
    速度:
    <span
      >{$appStateStore.displayFeedback
        ? fromRPM(
            $appStateStore.displayFeedback.speed,
            $appStateStore.velocityUnit,
          ).toFixed(2)
        : "--"}</span
    >
    <span class="unit-text"
      >{formatVelocityUnit($appStateStore.velocityUnit)}</span
    ><br />
    電流: <span>{$appStateStore.displayFeedback?.current ?? "--"}</span> mA<br
    />
    位置:
    <span
      >{$appStateStore.displayFeedback
        ? fromTicks(
            $appStateStore.displayFeedback.accumPosition,
            $appStateStore.positionUnit,
          ).toFixed(2)
        : "--"}</span
    >
    <span class="pos-unit-text">{$appStateStore.positionUnit}</span>
  </div>
</section>

<section class="debug-panel">
  <h2>ログ</h2>
  <div class="log-window">
    {#each $appStateStore.logEntries as log}
      <div class="log-entry">
        <span class="log-time">{log.time}</span>
        {log.message}
      </div>
    {/each}
  </div>
  <button id="clearLog" class="secondary" on:click={clearLog}>ログ消去</button>
</section>

<style>
  section {
    padding: 1.2rem;
    border-radius: 8px;
    background: var(--panel-bg);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
  }
  h2 {
    font-size: 1.1rem;
    margin-top: 0;
    margin-bottom: 1rem;
    border-left: 4px solid var(--primary-color);
    padding-left: 0.5rem;
  }
  .side-control-grid {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
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
  .feedback-info {
    margin-top: 1rem;
    padding: 0.8rem;
    background: #f8f9fa;
    border-radius: 4px;
    font-weight: bold;
    line-height: 1.6;
  }
  .safety-row {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  .safety-row label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .button-group {
    display: flex;
    gap: 0.5rem;
  }
  .status-bar {
    font-size: 0.85rem;
    margin-top: 0.5rem;
  }
  .status-offline {
    color: var(--danger-color);
    font-weight: bold;
  }
  button {
    padding: 0.6rem;
    border-radius: 4px;
    border: 1px solid #ced4da;
    background: #fff;
    cursor: pointer;
    font-weight: 600;
  }
  button.primary {
    background: var(--primary-color);
    color: #fff;
    border: none;
  }
  button.secondary {
    background: var(--secondary-color);
    color: #fff;
    border: none;
    width: 100%;
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .log-window {
    height: 120px;
    overflow-y: auto;
    background: #1e1e1e;
    color: #d4d4d4;
    padding: 0.5rem;
    font-family: monospace;
    font-size: 0.75rem;
    border-radius: 4px;
    margin-bottom: 0.5rem;
    display: flex;
    flex-direction: column-reverse;
  }
  .log-time {
    color: #888;
  }
  input[type="range"] {
    width: 100%;
    cursor: pointer;
  }
</style>
