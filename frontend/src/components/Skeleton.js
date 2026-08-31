import './Skeleton.css';

export function SkeletonBlock({ width, height, radius, className = '', style = {} }) {
  return (
    <span
      className={`skeleton-block ${className}`}
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

export function SkeletonText({ lines = 1, width = '100%', className = '' }) {
  const widths = Array.isArray(width) ? width : Array.from({ length: lines }, () => width);
  return (
    <span className={`skeleton-text ${className}`}>
      {Array.from({ length: lines }).map((_, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <SkeletonBlock key={index} height="0.9em" width={widths[index] || width} radius="4px" />
      ))}
    </span>
  );
}
