/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { RpmSample } from '../types';

interface SparklineProps {
  samples: RpmSample[];
}

export const Sparkline: React.FC<SparklineProps> = ({ samples }) => {
  const width = 100;
  const height = 30;

  const points = useMemo(() => {
    if (samples.length === 0) return '';

    const xValues = samples.map((s) => s.timeMs);
    const yValues = samples.map((s) => s.rpm);

    const xMin = 0;
    const xMax = Math.max(...xValues, 1);
    const yMin = 0;
    const yMax = Math.max(...yValues, 1);

    return samples
      .map((sample) => {
        const x = ((sample.timeMs - xMin) / (xMax - xMin)) * width;
        const y = height - ((sample.rpm - yMin) / (yMax - yMin)) * height;
        return `${x},${y}`;
      })
      .join(' ');
  }, [samples]);

  if (samples.length === 0) {
    return <div className="w-[100px] h-[30px] border border-dashed border-slate-800 rounded"></div>;
  }

  return (
    <svg width={width} height={height} className="overflow-visible select-none pointer-events-none">
      <polyline
        fill="none"
        stroke="#22d3ee"
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  );
};
