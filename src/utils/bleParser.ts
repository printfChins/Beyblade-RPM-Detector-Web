/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  RpmSample,
  DeviceState,
  LiveTelemetry,
  LaunchEvent,
  CurveStartInfo,
} from '../types';

export interface ParseResult {
  type: 'LIVE' | 'LAUNCH' | 'START' | 'DATA' | 'END' | 'UNKNOWN';
  liveData?: LiveTelemetry;
  launchEvent?: LaunchEvent;
  curveStartInfo?: CurveStartInfo;
  totalCount?: number;          // CURVE_START 封包解析出的總數量 (sample_count)
  sampleIntervalMs?: number;    // CURVE_START 封包解析出的取樣間隔 (nominal_sample_interval_ms)
  durationMs?: number;          // CURVE_START 封包解析出的預期總時間 (duration_ms)
  samples?: RpmSample[];        // CURVE_DATA 封包解析出的多筆轉速樣本
  sampleCountInPacket?: number; // CURVE_DATA 封包中的樣本數
  error?: string;               // 封包解析階段的錯誤
}

/**
 * 解析從 BLE 裝置接收到的二進位封包。
 * 遵循 Little Endian 格式讀取。
 * 
 * BRD API CMD V1.0 Packet IDs:
 * - 0xB1: LIVE (13 bytes)
 * - 0xB2: LAUNCH (9 bytes)
 * - 0xA1: CURVE_START (16 bytes)
 * - 0xA2: CURVE_DATA (2 + N * 4 bytes)
 * - 0xA3: CURVE_END (1 byte)
 * 
 * @param data 接收到的原始資料，支援 DataView (實體 BLE) 或 Uint8Array
 * @returns 解析結果物件
 */
export function parseBlePacket(data: DataView | Uint8Array): ParseResult {
  let view: DataView;
  if (data instanceof Uint8Array) {
    view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  } else {
    view = data;
  }

  // 封包長度檢查
  if (view.byteLength < 1) {
    return { type: 'UNKNOWN', error: '封包長度為 0' };
  }

  const packetType = view.getUint8(0);

  switch (packetType) {
    // ----------------------------------------------------
    // 0xB1: LIVE 即時數據封包 (13 Bytes)
    // ----------------------------------------------------
    case 0xB1: {
      if (view.byteLength !== 13) {
        return {
          type: 'LIVE',
          error: `0xB1 LIVE 封包長度錯誤，預期 13 位元組，實際為 ${view.byteLength} 位元組`,
        };
      }

      const rawState = view.getUint8(1);
      const state: DeviceState = rawState <= 4 ? rawState : DeviceState.WAIT_LOAD;
      const flagsRaw = view.getUint8(2);

      const flags = {
        loaded: (flagsRaw & 0x01) !== 0,
        measurementActive: (flagsRaw & 0x02) !== 0,
        launchMarkerValid: (flagsRaw & 0x04) !== 0,
        resultPending: (flagsRaw & 0x08) !== 0,
        charging: (flagsRaw & 0x10) !== 0,
      };

      const currentRpm = view.getUint16(3, true);
      const maxRpm = view.getUint16(5, true);
      const launchRpm = view.getUint16(7, true);
      const elapsedMs = view.getUint16(9, true);
      const curveSampleCount = view.getUint16(11, true);

      const liveData: LiveTelemetry = {
        state,
        flags,
        currentRpm,
        maxRpm,
        launchRpm,
        elapsedMs,
        curveSampleCount,
      };

      return {
        type: 'LIVE',
        liveData,
      };
    }

    // ----------------------------------------------------
    // 0xB2: LAUNCH 發射事件封包 (9 Bytes)
    // ----------------------------------------------------
    case 0xB2: {
      if (view.byteLength !== 9) {
        return {
          type: 'LAUNCH',
          error: `0xB2 LAUNCH 封包長度錯誤，預期 9 位元組，實際為 ${view.byteLength} 位元組`,
        };
      }

      const launchRpm = view.getUint16(1, true);
      const maxRpmAtLaunch = view.getUint16(3, true);
      const launchTimeMs = view.getUint16(5, true);
      const launchSampleIndex = view.getUint16(7, true);

      const launchEvent: LaunchEvent = {
        launchRpm,
        maxRpmAtLaunch,
        launchTimeMs,
        launchSampleIndex,
      };

      return {
        type: 'LAUNCH',
        launchEvent,
      };
    }

    // ----------------------------------------------------
    // 0xA1: CURVE_START 曲線摘要與開始 (16 Bytes, 支援相容 7 Bytes)
    // ----------------------------------------------------
    case 0xA1: {
      if (view.byteLength !== 16 && view.byteLength !== 7) {
        return {
          type: 'START',
          error: `0xA1 CURVE_START 封包長度錯誤，預期 16 位元組 (舊版 7 位元組)，實際為 ${view.byteLength} 位元組`,
        };
      }

      const sampleCount = view.getUint16(1, true);
      const nominalSampleIntervalMs = view.getUint16(3, true);
      const durationMs = view.getUint16(5, true);

      let maxRpm = 0;
      let launchRpm = 0;
      let launchTimeMs = 0;
      let launchSampleIndex = 0xFFFF;
      let launchMarkerValid = false;

      if (view.byteLength === 16) {
        maxRpm = view.getUint16(7, true);
        launchRpm = view.getUint16(9, true);
        launchTimeMs = view.getUint16(11, true);
        launchSampleIndex = view.getUint16(13, true);
        const flagsRaw = view.getUint8(15);
        launchMarkerValid = (flagsRaw & 0x01) !== 0;
      }

      const curveStartInfo: CurveStartInfo = {
        sampleCount,
        nominalSampleIntervalMs,
        durationMs,
        maxRpm,
        launchRpm,
        launchTimeMs,
        launchSampleIndex,
        launchMarkerValid,
      };

      return {
        type: 'START',
        curveStartInfo,
        totalCount: sampleCount,
        sampleIntervalMs: nominalSampleIntervalMs,
        durationMs,
      };
    }

    // ----------------------------------------------------
    // 0xA2: CURVE_DATA 曲線資料封包 (2 + N * 4 Bytes, N = 1~4)
    // ----------------------------------------------------
    case 0xA2: {
      if (view.byteLength < 2) {
        return {
          type: 'DATA',
          error: '0xA2 CURVE_DATA 封包長度不足 2 位元組',
        };
      }

      const sampleCount = view.getUint8(1);
      
      if (sampleCount < 1 || sampleCount > 4) {
        return {
          type: 'DATA',
          error: `0xA2 CURVE_DATA 封包內的樣本數 (${sampleCount}) 必須在 1 到 4 之間`,
        };
      }

      const expectedBytes = 2 + sampleCount * 4;
      if (view.byteLength !== expectedBytes) {
        return {
          type: 'DATA',
          error: `0xA2 CURVE_DATA 封包長度錯誤，預期為 ${expectedBytes} 位元組，實際為 ${view.byteLength} 位元組`,
        };
      }

      const samples: RpmSample[] = [];

      for (let i = 0; i < sampleCount; i++) {
        const offset = 2 + i * 4;
        const timeMs = view.getUint16(offset, true);
        const rpm = view.getUint16(offset + 2, true);
        samples.push({ timeMs, rpm });
      }

      return {
        type: 'DATA',
        sampleCountInPacket: sampleCount,
        samples,
      };
    }

    // ----------------------------------------------------
    // 0xA3: CURVE_END 曲線結束封包 (1 Byte)
    // ----------------------------------------------------
    case 0xA3: {
      if (view.byteLength !== 1) {
        return {
          type: 'END',
          error: `0xA3 CURVE_END 封包長度錯誤，預期 1 位元組，實際為 ${view.byteLength} 位元組`,
        };
      }
      return {
        type: 'END',
      };
    }

    default:
      return {
        type: 'UNKNOWN',
        error: `未知的二進位封包類型: 0x${packetType.toString(16).toUpperCase()}`,
      };
  }
}

/**
 * 模擬封包產生工具 Helper
 */
export function buildLivePacket(
  state: DeviceState,
  loaded: boolean,
  currentRpm: number,
  maxRpm: number,
  launchRpm: number = 0,
  elapsedMs: number = 0
): Uint8Array {
  const buf = new Uint8Array(13);
  buf[0] = 0xB1; // LIVE header
  buf[1] = state;
  buf[2] = (loaded ? 0x01 : 0x00) | 0x02; // loaded + measurement active
  const view = new DataView(buf.buffer);
  view.setUint16(3, currentRpm, true);
  view.setUint16(5, maxRpm, true);
  view.setUint16(7, launchRpm, true);
  view.setUint16(9, elapsedMs, true);
  view.setUint16(11, 0, true);
  return buf;
}

export function buildLaunchPacket(
  launchRpm: number,
  maxRpmAtLaunch: number,
  launchTimeMs: number,
  launchSampleIndex: number
): Uint8Array {
  const buf = new Uint8Array(9);
  buf[0] = 0xB2; // LAUNCH header
  const view = new DataView(buf.buffer);
  view.setUint16(1, launchRpm, true);
  view.setUint16(3, maxRpmAtLaunch, true);
  view.setUint16(5, launchTimeMs, true);
  view.setUint16(7, launchSampleIndex, true);
  return buf;
}

export function buildStartPacket(
  sampleCount: number,
  intervalMs: number = 50,
  durationMs: number = 1000,
  maxRpm: number = 8000,
  launchRpm: number = 7500,
  launchTimeMs: number = 100,
  launchSampleIndex: number = 2
): Uint8Array {
  const buf = new Uint8Array(16);
  buf[0] = 0xA1; // START header
  const view = new DataView(buf.buffer);
  view.setUint16(1, sampleCount, true);
  view.setUint16(3, intervalMs, true);
  view.setUint16(5, durationMs, true);
  view.setUint16(7, maxRpm, true);
  view.setUint16(9, launchRpm, true);
  view.setUint16(11, launchTimeMs, true);
  view.setUint16(13, launchSampleIndex, true);
  buf[15] = 0x01; // launch marker valid
  return buf;
}

export function buildDataPacket(samples: RpmSample[]): Uint8Array {
  const byteLength = 2 + samples.length * 4;
  const buf = new Uint8Array(byteLength);
  buf[0] = 0xA2; // DATA header
  buf[1] = samples.length;

  const view = new DataView(buf.buffer);
  samples.forEach((sample, idx) => {
    const offset = 2 + idx * 4;
    view.setUint16(offset, sample.timeMs, true);
    view.setUint16(offset + 2, sample.rpm, true);
  });

  return buf;
}

export function buildEndPacket(): Uint8Array {
  const buf = new Uint8Array(1);
  buf[0] = 0xA3; // END header
  return buf;
}
