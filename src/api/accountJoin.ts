import axios from 'axios';
import tweetnacl from 'tweetnacl';
import { randomBytes } from 'node:crypto';
import { configuration } from '@/configuration';
import { decodeBase64, encodeBase64 } from './encryption';

const ACCOUNT_JOIN_TICKET_PREFIX = 'aha_join_';
// New short join codes: 6 uppercase alphanumeric chars (e.g. A3X9K2)
const JOIN_CODE_REGEX = /^[A-Z2-9]{6}$/;

export function isAccountJoinTicket(code: string): boolean {
  return code.startsWith(ACCOUNT_JOIN_TICKET_PREFIX) || JOIN_CODE_REGEX.test(code);
}

function readJoinTicketFromResponse(data: any): string {
  if (typeof data?.ticket === 'string' && data.ticket.length > 0) {
    return data.ticket;
  }
  if (typeof data?.joinTicket === 'string' && data.joinTicket.length > 0) {
    return data.joinTicket;
  }
  if (typeof data?.code === 'string' && data.code.startsWith(ACCOUNT_JOIN_TICKET_PREFIX)) {
    return data.code;
  }
  throw new Error('Server did not return a join ticket');
}

function generateEphemeralBoxKeyPair() {
  const secret = new Uint8Array(randomBytes(tweetnacl.box.secretKeyLength));
  return tweetnacl.box.keyPair.fromSecretKey(secret);
}

function decryptJoinPayload(encryptedBundle: Uint8Array, recipientSecretKey: Uint8Array): Uint8Array | null {
  const ephemeralPublicKey = encryptedBundle.slice(0, tweetnacl.box.publicKeyLength);
  const nonce = encryptedBundle.slice(
    tweetnacl.box.publicKeyLength,
    tweetnacl.box.publicKeyLength + tweetnacl.box.nonceLength,
  );
  const encrypted = encryptedBundle.slice(tweetnacl.box.publicKeyLength + tweetnacl.box.nonceLength);

  return tweetnacl.box.open(encrypted, nonce, ephemeralPublicKey, recipientSecretKey);
}

function describeRedeemJoinError(error: unknown, ticket: string): string {
  if (axios.isAxiosError(error)) {
    const responseCode = error.response?.data?.code;
    const responseError = typeof error.response?.data?.error === 'string'
      ? error.response.data.error
      : null;

    if (responseCode === 'JOIN_TICKET_INVALID') {
      return `Join code "${ticket}" is invalid or expired on ${configuration.serverUrl}. Generate a fresh code with \`aha auth show-join-code\` on a signed-in device.`;
    }

    if (responseCode === 'RECOVERY_NOT_READY') {
      return 'Automatic recovery is not ready for this account yet. Finish recovery setup on the source machine, then generate a fresh join code.';
    }

    if (responseError) {
      return responseError;
    }

    if (error.response?.status) {
      return `Request failed with status code ${error.response.status}`;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

export async function redeemAccountJoinTicket(ticket: string): Promise<{
  token: string;
  userId: string;
  secret: Uint8Array;
}> {
  const keypair = generateEphemeralBoxKeyPair();

  let response;
  try {
    response = await axios.post(`${configuration.serverUrl}/v1/auth/account/join`, {
      ticket,
      publicKey: encodeBase64(keypair.publicKey),
    });
  } catch (error) {
    throw new Error(describeRedeemJoinError(error, ticket));
  }

  const encryptedContentSecretKey = decodeBase64(response.data.encryptedContentSecretKey);
  const secret = decryptJoinPayload(encryptedContentSecretKey, keypair.secretKey);
  if (!secret) {
    throw new Error('Failed to decrypt joined account secret');
  }

  return {
    token: response.data.token,
    userId: response.data.userId,
    secret,
  };
}

export async function createAccountJoinTicket(token: string): Promise<{
  ticket: string;
  expiresAt?: string | number | null;
}> {
  const response = await axios.post(
    `${configuration.serverUrl}/v1/account/join-ticket`,
    {},
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
  );

  // Server returns `code` (new JoinCode) and `ticket` alias for backward compat. Prefer `code`.
  const code = response.data?.code;
  const ticket = (typeof code === 'string' && code.length > 0)
    ? code
    : readJoinTicketFromResponse(response.data);

  return {
    ticket,
    expiresAt: response.data?.expiresAt ?? null,
  };
}
