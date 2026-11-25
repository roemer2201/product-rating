import { strings } from '@/lib/strings';

/** The same mark as the installed PWA. The adjacent name labels it. */
export function Brand() {
  return (
    <span className="brand">
      <img src={`${import.meta.env.BASE_URL}icon.svg`} width="34" height="34" alt="" />
      {strings.app.name}
    </span>
  );
}
