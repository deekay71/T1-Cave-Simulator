import { createTicketVerifier, loadPublicJwks } from '@te-liet/auth';

/** Game server chỉ giữ khóa công khai: xác minh được vé nhưng không ký được vé. */
export const verifyTicket = createTicketVerifier(await loadPublicJwks());
