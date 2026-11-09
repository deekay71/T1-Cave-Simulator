// In ra cặp khóa ký vé dạng KEY='json': API cần TICKET_PRIVATE_JWK, game chỉ cần TICKET_PUBLIC_JWKS.
// Dùng: npm run -s keys > .env   (Compose, `node --env-file` và `. ./.env` đều đọc được). Không commit khóa riêng.
import { generateTicketKeys } from '@te-liet/auth';

const { privateJwk, publicJwks } = await generateTicketKeys();
console.log(`TICKET_PRIVATE_JWK='${JSON.stringify(privateJwk)}'`);
console.log(`TICKET_PUBLIC_JWKS='${JSON.stringify(publicJwks)}'`);
