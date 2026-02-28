<script lang="ts">
  import { appStateStore } from "../state/app";
</script>

<section class="monitor-panel">
  <h2>受信モニター</h2>
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th class="col-time">時刻</th>
          <th class="col-id">ID</th>
          <th class="col-dlc">DLC</th>
          <th class="col-data">データ</th>
        </tr>
      </thead>
      <tbody>
        {#each $appStateStore.displayMonitorFrames as frame}
          <tr>
            <td>{frame.time}</td>
            <td>{frame.id}</td>
            <td>{frame.dlc}</td>
            <td>{frame.data}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
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
  .monitor-panel {
    overflow-x: auto;
  }
  .table-container {
    min-width: 800px;
    height: 150px;
    overflow-y: auto;
    font-size: 0.8rem;
    border: 1px solid #eee;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas,
      "Liberation Mono", monospace;
  }
  th,
  td {
    padding: 0.4rem;
    text-align: left;
    border-bottom: 1px solid #f0f0f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .col-time {
    width: 220px;
  }
  .col-id {
    width: 80px;
  }
  .col-dlc {
    width: 60px;
  }
</style>
