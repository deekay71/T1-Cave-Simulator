/** Room IDs identify a destination, never grant authentication or bypass close-test access. */
export function requestedRoom(href: string): string | null {
  try {
    const value = new URL(href).searchParams.get('room');
    return value && /^[A-Za-z0-9_-]{4,80}$/.test(value) ? value : null;
  } catch { return null; }
}
export function roomInviteUrl(href: string, roomId: string): string {
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(roomId)) throw new Error('Invalid room');
  const url = new URL(href);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL');
  url.username = ''; url.password = '';
  // Share only the room locator, never close-test codes, debug flags, or credentials.
  url.search = ''; url.hash = ''; url.searchParams.set('room', roomId);
  return url.toString();
}
