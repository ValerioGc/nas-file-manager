const NAS_BASE = '/apps/nas-file-manager/';

export function appApiUrl(path: string, moduleUrl = import.meta.url): string {
  const assetPath = new URL(moduleUrl).pathname;
  const assets = assetPath.lastIndexOf('/assets/');
  if (assets >= 0) {
    return `${assetPath.slice(0, assets + 1)}${path}`;
  }
  const frameSource = window.frameElement?.getAttribute('src');
  const onNas =
    window.location.pathname.startsWith(NAS_BASE) || frameSource?.startsWith(NAS_BASE) === true;
  return onNas ? `${NAS_BASE}${path}` : path;
}
