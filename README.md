# robomaster-web-can

RoboMasterモーターをWeb Serial経由でCAN制御するためのブラウザアプリです。  
速度PID、位置PID、カスケードPID（外側: 位置 / 内側: 速度）を切り替えて利用できます。

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
