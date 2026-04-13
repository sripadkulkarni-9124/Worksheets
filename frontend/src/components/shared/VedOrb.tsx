interface VedOrbProps {
  size?: number;
  speaking?: boolean;
}

export default function VedOrb({ size = 40, speaking = false }: VedOrbProps) {
  const orbStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    background: 'radial-gradient(circle at 35% 35%, #fbbf24, #f59e0b, #d97706)',
    boxShadow: speaking
      ? `0 0 ${size * 0.4}px rgba(245, 158, 11, 0.5), 0 0 ${size * 0.8}px rgba(245, 158, 11, 0.2)`
      : `0 0 ${size * 0.3}px rgba(245, 158, 11, 0.25)`,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'box-shadow 0.3s ease',
    animation: speaking ? 'pulse 1.5s ease-in-out infinite' : undefined,
  };

  const innerStyle: React.CSSProperties = {
    width: size * 0.35,
    height: size * 0.35,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(255,255,255,0.9), rgba(255,255,255,0.5))',
    boxShadow: '0 0 8px rgba(255,255,255,0.3)',
  };

  return (
    <div style={orbStyle}>
      <div style={innerStyle} />
    </div>
  );
}
