/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo } from 'react';
import { Gauge } from 'lucide-react';
import { RpmSample } from '../types';

interface RpmChartProps {
  samples: RpmSample[];
  activeLabel?: string;
  launchRpm?: number;
  launchTimeMs?: number;
  launchMarkerValid?: boolean;
}

export const RpmChart: React.FC<RpmChartProps> = ({
  samples,
  activeLabel = '最新轉速數據',
  launchRpm,
  launchTimeMs,
  launchMarkerValid = true,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // SVG 畫布高度固定，內部使用相對座標系統
  const height = 400;

  // 邊界間距
  const padding = {
    top: 40,
    right: 40,
    bottom: 50,
    left: 65,
  };

  // 計算數據極值與範圍
  const stats = useMemo(() => {
    if (samples.length === 0) {
      return {
        xMin: 0,
        xMax: 1000,
        yMin: 0,
        yMax: 8000,
        maxSample: null,
      };
    }

    const xValues = samples.map((s) => s.timeMs);
    const yValues = samples.map((s) => s.rpm);

    const xMin = 0; // X 軸一律從 0ms 開始
    const xMax = Math.max(...xValues, 100); // X軸依照數據調整寬度

    const yMin = 0; // Y 軸轉速從 0 開始
    const maxVal = Math.max(...yValues);
    // Y 軸最大刻度自動四捨五入到最近的千位數，並多留 10% 空間
    const rawYMax = Math.max(maxVal * 1.1, 4000);
    const yMax = Math.ceil(rawYMax / 1000) * 1000;

    // 尋找最大轉速點
    let maxSample = samples[0];
    samples.forEach((s) => {
      if (s.rpm > maxSample.rpm) {
        maxSample = s;
      }
    });

    return { xMin, xMax, yMin, yMax, maxSample };
  }, [samples]);

  // 動態寬度計算：依據數據持續時間（秒）調整 X 軸寬度
  const width = useMemo(() => {
    if (samples.length === 0) return 800;
    const durationMs = stats.xMax - stats.xMin;
    const durationSec = durationMs / 1000;
    // 每秒數據給予 150 像素的寬度，使曲線在長時間下有足夠的拉伸空間。最少 800 像素。
    const pixelPerSecond = 150;
    const calculatedWidth = Math.round(durationSec * pixelPerSecond) + padding.left + padding.right;
    return Math.max(800, calculatedWidth);
  }, [samples, stats.xMax, stats.xMin, padding.left, padding.right]);

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // 座標轉換 helper (輸入實際數據，輸出畫布 SVG X, Y 座標)
  const getX = (timeMs: number) => {
    const ratio = (timeMs - stats.xMin) / (stats.xMax - stats.xMin);
    return padding.left + ratio * chartWidth;
  };

  const getY = (rpm: number) => {
    const ratio = (rpm - stats.yMin) / (stats.yMax - stats.yMin);
    return height - padding.bottom - ratio * chartHeight;
  };

  // 產生折線的 SVG Path
  const linePath = useMemo(() => {
    if (samples.length === 0) return '';
    return samples
      .map((sample, idx) => {
        const x = getX(sample.timeMs);
        const y = getY(sample.rpm);
        return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ');
  }, [samples, stats, chartWidth, chartHeight]);

  // 產生漸層填滿區域的 SVG Path
  const areaPath = useMemo(() => {
    if (samples.length === 0) return '';
    const firstX = getX(samples[0].timeMs);
    const lastX = getX(samples[samples.length - 1].timeMs);
    const bottomY = height - padding.bottom;

    return `${linePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
  }, [samples, linePath, stats, chartWidth, chartHeight, height, padding.bottom]);

  // 產生 Y 軸網格線與刻度 (預設 5 個區間)
  const yTicks = useMemo(() => {
    const ticks: number[] = [];
    const count = 5;
    const step = (stats.yMax - stats.yMin) / count;
    for (let i = 0; i <= count; i++) {
      ticks.push(stats.yMin + i * step);
    }
    return ticks;
  }, [stats]);

  // 產生 X 軸網格線與刻度 (預設 6 個區間，單位轉換為秒)
  const xTicks = useMemo(() => {
    const ticks: number[] = [];
    const count = 5;
    const step = (stats.xMax - stats.xMin) / count;
    for (let i = 0; i <= count; i++) {
      ticks.push(stats.xMin + i * step);
    }
    return ticks;
  }, [stats]);

  // 處理滑鼠滑過圖表時，尋找最近的數據點
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (!svgRef.current || samples.length === 0) return;

    // 取得滑鼠在 SVG 畫布中的相對座標
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;

    // 將滑鼠 X 座標轉換回 timeMs 數值
    const scaleX = rect.width / width; // 寬度縮放比例
    const actualSvgX = mouseX / scaleX;

    // 僅在圖表繪製範圍內才觸發 tooltip
    if (actualSvgX < padding.left || actualSvgX > width - padding.right) {
      setHoverIdx(null);
      return;
    }

    const hoverTimeMs =
      stats.xMin +
      ((actualSvgX - padding.left) / chartWidth) * (stats.xMax - stats.xMin);

    // 尋找時間差最小的點的索引
    let closestIdx = 0;
    let minDiff = Math.abs(samples[0].timeMs - hoverTimeMs);

    for (let i = 1; i < samples.length; i++) {
      const diff = Math.abs(samples[i].timeMs - hoverTimeMs);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }

    setHoverIdx(closestIdx);
  };

  const handleMouseLeave = () => {
    setHoverIdx(null);
  };

  const hoveredSample = hoverIdx !== null ? samples[hoverIdx] : null;

  return (
    <div id="rpm-chart-container" className="w-full bg-slate-950/60 border border-slate-900 rounded-2xl p-5 shadow-xl">
      <div className="flex justify-between items-center mb-4">
        <h3 id="chart-title" className="text-sm font-bold tracking-wider text-white flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]"></span>
          {activeLabel}
        </h3>
        <div className="flex gap-4 text-xs font-mono text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.8)]"></span>
            轉速 (RPM)
          </span>
          {samples.length > 0 && (
            <span>
              取樣點數: <strong className="text-cyan-400 font-bold">{samples.length}</strong> 筆
            </span>
          )}
        </div>
      </div>

      <div className="relative w-full overflow-x-auto scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent pb-2">
        {samples.length === 0 ? (
          // 空資料狀態
          <div id="chart-empty-state" className="flex flex-col items-center justify-center h-[350px] bg-slate-950/20 rounded-xl border border-dashed border-slate-900 p-8 text-center min-w-[300px]">
            <div className="w-12 h-12 rounded-full bg-slate-900/60 flex items-center justify-center mb-3 animate-pulse text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.15)]">
              <Gauge className="w-6 h-6 text-cyan-400" />
            </div>
            <h4 className="text-sm font-bold text-white tracking-wide">目前無轉速數據紀錄</h4>
            <p className="text-xs text-slate-400 max-w-xs mt-1.5 leading-relaxed font-sans">
              請連接 BRD_ 裝置，並啟動旋轉以進行轉速量測。
            </p>
          </div>
        ) : (
          // 繪製 SVG 折線圖
          <svg
            id="rpm-svg-chart"
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            style={{ width: `${width}px`, minWidth: '100%', height: `${height}px` }}
            className="select-none overflow-visible shrink-0"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <defs>
              {/* 漸層填滿 */}
              <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
              </linearGradient>
              {/* 網格虛線 */}
              <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
                <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
              </pattern>
            </defs>

            {/* 背景網格 */}
            <rect
              x={padding.left}
              y={padding.top}
              width={chartWidth}
              height={chartHeight}
              fill="url(#grid)"
            />

            {/* Y 軸水平網格線與標籤 */}
            {yTicks.map((tick, i) => {
              const y = getY(tick);
              return (
                <g key={`y-${tick}-${i}`} className="opacity-80">
                  <line
                    x1={padding.left}
                    y1={y}
                    x2={width - padding.right}
                    y2={y}
                    stroke="rgba(148, 163, 184, 0.08)"
                    strokeWidth={i === 0 ? 1.5 : 1}
                    strokeDasharray={i === 0 ? undefined : '4 4'}
                  />
                  <text
                    x={padding.left - 12}
                    y={y + 4}
                    textAnchor="end"
                    className="text-[10px] font-mono fill-slate-500 font-medium"
                  >
                    {Math.round(tick)}
                  </text>
                </g>
              );
            })}

            {/* X 軸垂直網格線與標籤 */}
            {xTicks.map((tick, i) => {
              const x = getX(tick);
              const timeSec = (tick / 1000).toFixed(1);
              return (
                <g key={`x-${tick}-${i}`} className="opacity-80">
                  <line
                    x1={x}
                    y1={padding.top}
                    x2={x}
                    y2={height - padding.bottom}
                    stroke="rgba(148, 163, 184, 0.08)"
                    strokeWidth={i === 0 ? 1.5 : 1}
                    strokeDasharray={i === 0 ? undefined : '4 4'}
                  />
                  <text
                    x={x}
                    y={height - padding.bottom + 22}
                    textAnchor="middle"
                    className="text-[10px] font-mono fill-slate-500 font-medium"
                  >
                    {timeSec}s
                  </text>
                </g>
              );
            })}

            {/* 軸標題 */}
            <text
              x={padding.left - 50}
              y={padding.top - 12}
              className="text-[9px] font-bold tracking-widest fill-slate-600 uppercase font-mono"
            >
              RPM
            </text>
            <text
              x={width - padding.right}
              y={height - padding.bottom + 35}
              textAnchor="end"
              className="text-[9px] font-bold tracking-widest fill-slate-600 uppercase font-mono"
            >
              Time (Sec)
            </text>

            {/* 漸層填滿區域 */}
            <path d={areaPath} fill="url(#areaGradient)" />

            {/* 數據折線 */}
            <path
              d={linePath}
              fill="none"
              stroke="#06b6d4"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="drop-shadow-[0_0_10px_rgba(6,182,212,0.55)]"
            />

            {/* 標記發射點 (LAUNCH) 與 最高點 (MAX) 標籤（無遮擋與防重疊邏輯） */}
            {(() => {
              // 1. MAX Sample Info
              const hasMax = !!stats.maxSample;
              const maxPointX = hasMax ? getX(stats.maxSample!.timeMs) : 0;
              const maxPointY = hasMax ? getY(stats.maxSample!.rpm) : 0;
              const maxLabelText = hasMax ? `MAX ${stats.maxSample!.rpm.toLocaleString()} RPM` : '';
              const maxBadgeW = hasMax ? Math.max(84, maxLabelText.length * 6.5 + 16) : 0;
              const maxHalfW = maxBadgeW / 2;
              const maxBadgeX = hasMax ? Math.max(padding.left + maxHalfW, Math.min(width - padding.right - maxHalfW, maxPointX)) : 0;
              let maxBadgeY = hasMax ? Math.max(18, maxPointY - 22) : 0;

              // 2. Launch Info
              const showLaunch = launchTimeMs !== undefined && launchMarkerValid;
              let effectiveLaunchRpm: number | undefined = undefined;
              if (showLaunch) {
                effectiveLaunchRpm = launchRpm !== undefined
                  ? launchRpm
                  : (samples.length > 0 ? (() => {
                      let closest = samples[0];
                      for (const s of samples) {
                        if (Math.abs(s.timeMs - launchTimeMs!) < Math.abs(closest.timeMs - launchTimeMs!)) {
                          closest = s;
                        }
                      }
                      return closest.rpm;
                    })() : undefined);
              }
              const launchPointX = showLaunch ? getX(launchTimeMs!) : 0;
              const launchPointY = showLaunch ? (effectiveLaunchRpm !== undefined ? getY(effectiveLaunchRpm) : getY(0)) : 0;
              const launchLabelText = showLaunch
                ? (effectiveLaunchRpm !== undefined ? `LAUNCH ${effectiveLaunchRpm.toLocaleString()} RPM` : 'LAUNCH')
                : '';
              const launchBadgeW = showLaunch ? Math.max(84, launchLabelText.length * 6.5 + 16) : 0;
              const launchHalfW = launchBadgeW / 2;
              const launchBadgeX = showLaunch ? Math.max(padding.left + launchHalfW, Math.min(width - padding.right - launchHalfW, launchPointX)) : 0;

              // 計算 Launch 標籤涵蓋範圍內曲線的最高點 (最小 Y)，確保標籤高於曲線
              const launchSpanMinY = (() => {
                if (!showLaunch) return 0;
                let minY = launchPointY;
                for (const s of samples) {
                  const sx = getX(s.timeMs);
                  if (sx >= launchBadgeX - launchHalfW - 8 && sx <= launchBadgeX + launchHalfW + 8) {
                    const sy = getY(s.rpm);
                    if (sy < minY) minY = sy;
                  }
                }
                return minY;
              })();

              let launchBadgeY = showLaunch ? Math.max(18, launchSpanMinY - 22) : 0;

              // 3. 防重疊與防遮擋調整 (Overlap resolution)
              if (hasMax && showLaunch) {
                const xDist = Math.abs(maxBadgeX - launchBadgeX);
                const minXOverlapDist = maxHalfW + launchHalfW + 8;
                if (xDist < minXOverlapDist) {
                  if (Math.abs(maxBadgeY - launchBadgeY) < 24) {
                    if (maxBadgeY >= 42) {
                      launchBadgeY = maxBadgeY - 24;
                    } else {
                      launchBadgeY = 18;
                      maxBadgeY = 42;
                    }
                  }
                }
              }

              return (
                <g>
                  {/* 標記發射點 (Launch Point) */}
                  {showLaunch && (
                    <g>
                      <line
                        x1={launchPointX}
                        y1={padding.top}
                        x2={launchPointX}
                        y2={height - padding.bottom}
                        stroke="#f59e0b"
                        strokeWidth="2"
                        strokeDasharray="4 2"
                        className="drop-shadow-[0_0_6px_rgba(245,158,11,0.8)]"
                      />
                      <circle
                        cx={launchPointX}
                        cy={launchPointY}
                        r="5"
                        fill="#f59e0b"
                        stroke="#ffffff"
                        strokeWidth="2"
                      />
                      {hoverIdx === null && (
                        <g transform={`translate(${launchBadgeX}, ${launchBadgeY})`}>
                          <rect
                            x={-launchHalfW}
                            y="-12"
                            width={launchBadgeW}
                            height="18"
                            rx="4"
                            fill="rgba(245, 158, 11, 0.95)"
                            className="shadow-lg"
                          />
                          <text
                            textAnchor="middle"
                            y="1"
                            className="text-[9px] font-black fill-slate-950 font-mono"
                          >
                            {launchLabelText}
                          </text>
                        </g>
                      )}
                    </g>
                  )}

                  {/* 標記最大 RPM 點 (MAX Point) */}
                  {hasMax && (
                    <g>
                      {/* 當 MAX 標籤 elevated 時繪製連線至圓點 */}
                      {maxPointY - maxBadgeY > 16 && (
                        <line
                          x1={maxPointX}
                          y1={maxBadgeY + 6}
                          x2={maxPointX}
                          y2={maxPointY - 5}
                          stroke="#ec4899"
                          strokeWidth="1.5"
                          strokeDasharray="2 2"
                          opacity="0.8"
                        />
                      )}
                      <circle
                        cx={maxPointX}
                        cy={maxPointY}
                        r="5"
                        fill="#ec4899"
                        stroke="#ffffff"
                        strokeWidth="2"
                      />
                      {hoverIdx === null && (
                        <g transform={`translate(${maxBadgeX}, ${maxBadgeY})`}>
                          <rect
                            x={-maxHalfW}
                            y="-12"
                            width={maxBadgeW}
                            height="18"
                            rx="4"
                            fill="rgba(236, 72, 153, 0.95)"
                            className="shadow-md"
                          />
                          <text
                            textAnchor="middle"
                            y="1"
                            className="text-[9px] font-black fill-white font-mono"
                          >
                            {maxLabelText}
                          </text>
                        </g>
                      )}
                    </g>
                  )}
                </g>
              );
            })()}

            {/* 懸停十字準心與點亮指示器 */}
            {hoveredSample && (
              <g>
                {/* 垂直虛線 */}
                <line
                  x1={getX(hoveredSample.timeMs)}
                  y1={padding.top}
                  x2={getX(hoveredSample.timeMs)}
                  y2={height - padding.bottom}
                  stroke="rgba(6, 182, 212, 0.45)"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                />
                {/* 水平虛線 */}
                <line
                  x1={padding.left}
                  y1={getY(hoveredSample.rpm)}
                  x2={width - padding.right}
                  y2={getY(hoveredSample.rpm)}
                  stroke="rgba(6, 182, 212, 0.45)"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                />
                {/* 焦點圓點 */}
                <circle
                  cx={getX(hoveredSample.timeMs)}
                  cy={getY(hoveredSample.rpm)}
                  r="6.5"
                  fill="#06b6d4"
                  stroke="#ffffff"
                  strokeWidth="2"
                  className="shadow-lg"
                />
              </g>
            )}
          </svg>
        )}

        {/* 懸停浮動 Tooltip 元件 */}
        {hoveredSample && (
          <div
            id="chart-hover-tooltip"
            className="absolute bg-[#0d0f14]/95 border border-cyan-500/40 rounded-xl p-3 shadow-[0_0_15px_rgba(6,182,212,0.15)] text-xs font-mono text-slate-100 flex flex-col gap-1.5 pointer-events-none transition-all duration-75 backdrop-blur-sm"
            style={{
              left: `${Math.min(
                Math.max(getX(hoveredSample.timeMs) - 65, padding.left - 20),
                width - padding.right - 105
              )}px`,
              top: `${Math.max(getY(hoveredSample.rpm) - 80, 10)}px`,
              width: '140px',
              zIndex: 50,
            }}
          >
            <div className="text-slate-400 border-b border-slate-900 pb-1.5 mb-1 flex justify-between">
              <span>時間 (Time)</span>
              <span className="text-cyan-400 font-bold">{(hoveredSample.timeMs / 1000).toFixed(2)}s</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">轉速 (RPM)</span>
              <span className="text-pink-400 font-black text-sm">{hoveredSample.rpm.toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
