/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RpmSample, SimulatorPreset } from '../types';

export const SIMULATOR_PRESETS: SimulatorPreset[] = [
  {
    name: '穩定持久型 (Stamina)',
    description: '高初速、極低風阻衰減，適合長時期旋轉與平穩的軌道運行。',
    initialRpm: 6800,
    decayRate: 0.08, // 衰減係數
    wobbleIntensity: 15, // 搖晃晃動幅度
    collisionCount: 1, // 碰撞次數
    durationMs: 25000, // 25秒
  },
  {
    name: '暴烈攻擊型 (Attack)',
    description: '初始轉速爆發、風阻衰減極高，中途伴隨多次劇烈碰撞與彈跳。',
    initialRpm: 8800,
    decayRate: 0.22,
    wobbleIntensity: 50,
    collisionCount: 4,
    durationMs: 14000, // 14秒
  },
  {
    name: '鋼鐵防禦型 (Defense)',
    description: '轉速中等、抗衝擊能力佳，旋轉過程中軌道與震動極為平穩。',
    initialRpm: 5200,
    decayRate: 0.12,
    wobbleIntensity: 8,
    collisionCount: 2,
    durationMs: 18000, // 18秒
  },
  {
    name: '極限暴走 (Over-Limit)',
    description: '超越極限的 10000+ RPM 發射！隨之而來的是強大的晃動與極速失速。',
    initialRpm: 10500,
    decayRate: 0.28,
    wobbleIntensity: 120,
    collisionCount: 3,
    durationMs: 11000, // 11秒
  },
];

/**
 * 產生物理模型戰鬥陀螺轉速數據，模擬真實的物理運作，包含：
 * 1. 發射瞬間的爬升 (Launch Spin-up)
 * 2. 指數型風阻衰減 (Exponential decay)
 * 3. 隨機微幅震盪/搖晃 (Wobbling)
 * 4. 中途衝擊與對戰碰撞造成的 RPM 急遽下降 (Clashes)
 * 5. 後期失去重心與重心不穩造成的末期急速失速 (Sleep-out decay)
 */
export function generateSimulatorData(preset: SimulatorPreset): RpmSample[] {
  const samples: RpmSample[] = [];
  const stepMs = 50; // 每 50ms 取樣一次 (20Hz)
  const totalSteps = Math.floor(preset.durationMs / stepMs);

  // 定義隨機碰撞的時間點與強度
  const collisionTimes = Array.from({ length: preset.collisionCount }, () =>
    Math.random() * 0.6 + 0.15 // 落在 15% ~ 75% 的生命週期
  ).sort();

  const collisionProfiles = collisionTimes.map((timeFraction) => ({
    timeFraction,
    rpmDrop: Math.random() * 800 + 400, // 掉 400 ~ 1200 RPM
    recoveryTimeMs: Math.random() * 600 + 400, // 400ms ~ 1000ms 內微幅回穩
  }));

  let currentRpm = 0;

  for (let i = 0; i <= totalSteps; i++) {
    const timeMs = i * stepMs;
    const t = timeMs / preset.durationMs; // 0.0 ~ 1.0 進度

    if (timeMs < 150) {
      // 1. 發射爬升階段：150ms 內拉到初速
      const progress = timeMs / 150;
      currentRpm = preset.initialRpm * Math.sin((progress * Math.PI) / 2);
    } else {
      // 2. 基本指數風阻衰減
      // RPM_t = RPM_0 * e^(-decay * t)
      const baseRpm = preset.initialRpm * Math.exp(-preset.decayRate * (t * 2.2));

      // 3. 處理隨機對戰碰撞 (Clashes)
      let collisionImpact = 0;
      collisionProfiles.forEach((profile) => {
        const cTimeMs = profile.timeFraction * preset.durationMs;
        if (timeMs >= cTimeMs) {
          const timeSinceCollision = timeMs - cTimeMs;
          if (timeSinceCollision < profile.recoveryTimeMs) {
            // 剛好碰撞時：直線下降
            const dipProgress = timeSinceCollision / 100; // 100ms 內猛降
            if (dipProgress < 1) {
              collisionImpact += profile.rpmDrop * dipProgress;
            } else {
              // 恢復期：緩緩回復 30% 跌幅 (因動量釋放但部分喪失)
              const recoveryProgress = (timeSinceCollision - 100) / (profile.recoveryTimeMs - 100);
              const totalLost = profile.rpmDrop;
              const recovered = totalLost * 0.25 * Math.sin((recoveryProgress * Math.PI) / 2);
              collisionImpact += totalLost - recovered;
            }
          } else {
            // 碰撞過後：永久喪失該次轉速
            collisionImpact += profile.rpmDrop * 0.75;
          }
        }
      });

      // 4. 計算陀螺重心晃動 (Wobble) - 隨時間越來越劇烈
      // 越到後期，晃動越大
      const wobbleFactor = preset.wobbleIntensity * (0.3 + t * 1.5);
      const wobble =
        Math.sin(timeMs / 120) * wobbleFactor * 0.4 +
        Math.sin(timeMs / 45) * wobbleFactor * 0.2 +
        (Math.random() - 0.5) * wobbleFactor * 0.3;

      // 5. 末期失速 (Sleep-out) - 當轉速過低 (< 1200 RPM) 或是時間到最後 15% 時
      let sleepOutDrop = 0;
      const sleepOutThreshold = 0.85; // 最後 15%
      if (t > sleepOutThreshold) {
        const sleepProgress = (t - sleepOutThreshold) / (1 - sleepOutThreshold);
        // 使用二次方快速崩塌
        sleepOutDrop = (baseRpm - collisionImpact) * Math.pow(sleepProgress, 2.5);
      }

      currentRpm = baseRpm - collisionImpact + wobble - sleepOutDrop;
    }

    // 確保轉速不為負值
    if (currentRpm < 0) {
      currentRpm = 0;
    }

    // 四捨五入為整數
    samples.push({
      timeMs,
      rpm: Math.round(currentRpm),
    });

    // 如果轉速已經到零且已經過了發射期，即可停止產生
    if (timeMs > 500 && currentRpm <= 0) {
      break;
    }
  }

  return samples;
}
