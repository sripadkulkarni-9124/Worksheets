import { useEffect, useState } from 'react';

interface Props {
  percent: number;
  size?: number;
}

export default function ScoreRing({ percent, size = 56 }: Props) {
  const [animatedPercent, setAnimatedPercent] = useState(0);
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (animatedPercent / 100) * circumference;

  // Animate on mount
  useEffect(() => {
    const timer = setTimeout(() => setAnimatedPercent(percent), 100);
    return () => clearTimeout(timer);
  }, [percent]);

  const color =
    percent >= 80
      ? '#22c55e'
      : percent >= 50
        ? '#f59e0b'
        : '#ef4444';

  return (
    <div
      style={{
        width: size,
        height: size,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 1s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </svg>
      <span
        style={{
          position: 'absolute',
          fontSize: size * 0.24,
          fontWeight: 700,
          fontFamily: 'var(--font-display)',
          color,
        }}
      >
        {Math.round(animatedPercent)}%
      </span>
    </div>
  );
}
