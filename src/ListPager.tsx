export function listPage<T>(items: readonly T[], requested: number, size: number) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(Math.max(0, requested), pages - 1);
  return { items: items.slice(page * size, (page + 1) * size), page, pages };
}
export function ListPager({
  label,
  page,
  pages,
  disabled,
  onChange,
}: {
  label: string;
  page: number;
  pages: number;
  disabled: boolean;
  onChange: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="registry-batch" aria-label={label}>
      <button
        className="secondary"
        disabled={disabled || page === 0}
        onClick={() => onChange(page - 1)}
        aria-label={`${label}上一页`}
      >
        上一页
      </button>
      <span>
        第 {page + 1} / {pages} 页
      </span>
      <button
        className="secondary"
        disabled={disabled || page + 1 === pages}
        onClick={() => onChange(page + 1)}
        aria-label={`${label}下一页`}
      >
        下一页
      </button>
    </nav>
  );
}
