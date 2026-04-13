import { imageUrl } from '../../api';

interface Props {
  urls: string[];
  currentPage: number;
  onSelect: (idx: number) => void;
}

export default function PageThumbnails({ urls, currentPage, onSelect }: Props) {
  return (
    <div style={styles.strip}>
      {urls.map((url, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          style={{
            ...styles.thumb,
            borderColor:
              i === currentPage
                ? '#f59e0b'
                : 'rgba(255,255,255,0.1)',
            opacity: i === currentPage ? 1 : 0.6,
          }}
        >
          <img
            src={imageUrl(url)}
            alt={`Page ${i + 1}`}
            style={styles.thumbImg}
          />
          <span style={styles.label}>{i + 1}</span>
        </button>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  strip: {
    position: 'absolute',
    right: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    zIndex: 10,
  },
  thumb: {
    width: 52,
    height: 68,
    borderRadius: 8,
    border: '2px solid rgba(255,255,255,0.1)',
    overflow: 'hidden',
    cursor: 'pointer',
    position: 'relative',
    padding: 0,
    background: 'rgba(0,0,0,0.4)',
    transition: 'all 0.2s',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  label: {
    position: 'absolute',
    bottom: 2,
    right: 4,
    fontSize: 10,
    fontWeight: 700,
    color: '#fff',
    textShadow: '0 1px 3px rgba(0,0,0,0.8)',
  },
};
