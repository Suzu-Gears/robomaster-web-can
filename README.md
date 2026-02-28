# robomaster-web-can

RoboMasterモーターを **SLCAN (slcan)** プロトコルを用い、**Web Serial API** 経由でCAN制御するためのブラウザアプリです。
専用のソフトウェアをインストールすることなく、ブラウザから直接モーターのPID調整やモニターが行えます。

## 特徴
- **SLCAN対応**: CAN-USB変換アダプタをシリアルポートとして認識し、CANメッセージをやり取りします。
- **マルチモード制御**: 速度PID、位置PID、カスケードPID（外側: 位置 / 内側: 速度）をリアルタイムに切り替えて利用可能。
- **可視化**: 目標値と実値の比較、積分器の蓄積状態、出力電流などをリアルタイムにグラフ表示。

## 対応ハードウェア
以下のSLCAN互換アダプタで使用可能です。CANバスの速度は **1Mbps** 固定で初期化されます。

- **CANable**: slcanファームウェアを書き込んだCANableなど。
- **[SLCAN_Arduino](https://github.com/Suzu-Gears/SLCAN_Arduino)**: ArduinoとCANコントローラを使用した自作アダプタ。
- その他、標準的なSLCANコマンド（`O`, `C`, `S`, `t` など）に対応したアダプタ。

## 使い方

1.  **アダプタの接続**: SLCANアダプタをPCに接続し、RoboMasterモーターとCANバスで繋ぎます。
2.  **アプリの起動**: 本アプリをブラウザで開きます。
3.  **接続**: 左側の「デバイスに接続」ボタンを押し、シリアルポートを選択します。
    - 接続成功時、安全のため自動的に「非常停止（出力0）」がかかります。
4.  **モーター設定**: 左側のサイドバーから、制御対象のモーター種別（C610/C620/GM6020）とCAN IDを選択します。
5.  **制御開始**: 「非常停止解除」ボタンを押し、スライダーやステップ入力でモーターを動かします。

## 注意事項
- **制御周期**: ブラウザのタイマー精度の制約により、送信周期は **最短10ms (100Hz)** です。
- **制御対象**: 一度に制御できるモーターは **1台のみ** です。
- **安全**: 通信途絶やタブの切り替えを検知すると自動的に非常停止（出力0）がかかるよう設計されていますが、実機を動かす際は常に注意してください。

## 開発

```bash
npm ci
npm run dev
```

ビルド:

```bash
npm run build
```

## PID制御の式と単位系

### 共通PID式

`src/lib/pid.ts` の実装は以下です。

- 誤差: `error = setpoint - measured`
- 積分: `integral += error * dt`（`[-iLimit, iLimit]` で飽和）
- 微分: `derivative = (error - prevError) / dt`
  - ただし `derivativeOverride` 指定時はその値を使用
- 出力: `output = kp * error + ki * integral + kd * derivative`

### 単位系

- 速度系の内部表現:
  - モーターFBの速度はRPM系入力
  - 速度ループ内部では `fromRPM(..., unit)` で表示単位へ変換
- 位置系:
  - モーター角度の内部生値はtick（1回転=8192tick）
  - 位置ループでは `fromTicks(..., positionUnit)` で `rad/deg/tick` に変換

### 位置ループの微分項と速度FBの符号

位置PID（単独/カスケード外側）の微分項は `d(error)/dt` を使います。
`error = target - measured` のため、

`d(error)/dt = d(target)/dt - d(measured)/dt`

目標位置が一定（ステップ後など）では `d(target)/dt ≈ 0` となり、

`d(error)/dt ≈ -d(measured)/dt`

になります。
そのため、速度フィードバックを微分入力として使う場合は、`src/lib/control/control-loop.ts` で**符号反転**してから `derivativeOverride` に渡しています。

- 実装箇所: `getPositionDerivativeOverride()`
- 挙動: `return -convertSpeedToPositionDerivative(...)`

## 内部値モニタの見方

位置PID / カスケードPIDでは、外側微分値の隣に `速度FB[*/s]` を表示します。

- `positionDerivativeSource = speedFeedback` のとき:
  - モニタの `速度FB` は微分項 (`d(error)/dt`) と比較しやすいように符号を揃えて表示
- `positionDerivativeSource = positionDiff` のとき:
  - `速度FB` は参考値として表示（微分項は誤差差分から計算）
