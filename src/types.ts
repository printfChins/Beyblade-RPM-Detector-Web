/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum ConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  SCANNING = 'SCANNING',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECEIVING = 'RECEIVING',
  ERROR = 'ERROR',
}

export enum AppMode {
  REAL = 'REAL',
  SIMULATOR = 'SIMULATOR',
}

/**
 * 韌體裝置狀態碼
 */
export enum DeviceState {
  WAIT_LOAD = 0,        // 等待裝載
  LOADED_READY = 1,     // 已裝載，等待 RPM 邊緣
  SPINNING_LOADED = 2,  // 裝載中旋轉
  SPINNING_LAUNCHED = 3,// 已發射，持續量測
  RESULT_PENDING = 4,   // 結果待傳或傳送中
}

/**
 * 0xB1 LIVE 狀態 Flag 解析結果
 */
export interface TelemetryFlags {
  loaded: boolean;            // bit0: loaded (HIGH = 已裝載)
  measurementActive: boolean; // bit1: measurement active
  launchMarkerValid: boolean; // bit2: launch marker valid
  resultPending: boolean;     // bit3: result pending
  charging: boolean;          // bit4: charging
}

/**
 * 0xB1 LIVE 即時傳輸數據
 */
export interface LiveTelemetry {
  state: DeviceState;
  flags: TelemetryFlags;
  currentRpm: number;
  maxRpm: number;
  launchRpm: number;
  elapsedMs: number;
  curveSampleCount: number;
}

/**
 * 0xB2 LAUNCH 發射事件數據
 */
export interface LaunchEvent {
  launchRpm: number;
  maxRpmAtLaunch: number;
  launchTimeMs: number;
  launchSampleIndex: number;
}

/**
 * 0xA1 CURVE_START 曲線摘要數據
 */
export interface CurveStartInfo {
  sampleCount: number;
  nominalSampleIntervalMs: number;
  durationMs: number;
  maxRpm: number;
  launchRpm: number;
  launchTimeMs: number;
  launchSampleIndex: number;
  launchMarkerValid: boolean;
}

export interface RpmSample {
  timeMs: number;
  rpm: number;
}

export interface SpinRecord {
  id: string;
  timestamp: string;
  name: string;
  maxRpm: number;
  avgRpm: number;
  durationMs: number;
  samples: RpmSample[];
  totalSamplesExpected?: number;
  // 發射點相關數據 (依 0xB2 或 0xA1)
  launchRpm?: number;
  launchTimeMs?: number;
  launchSampleIndex?: number;
  launchMarkerValid?: boolean;
}

export interface SimulatorPreset {
  name: string;
  description: string;
  initialRpm: number;
  decayRate: number; // Air resistance decay coefficient
  wobbleIntensity: number; // Vibration/wobble effect
  collisionCount: number; // Number of random collisions
  durationMs: number;
}

