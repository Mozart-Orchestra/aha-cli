import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPost = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: {
    post: mockPost,
    isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
  },
}));

vi.mock('@/configuration', () => ({
  configuration: {
    serverUrl: 'https://ahaagi.test',
  },
}));

import { createAccountJoinTicket, redeemAccountJoinTicket } from './accountJoin';

describe('createAccountJoinTicket', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('calls the authenticated join-ticket endpoint and returns the ticket', async () => {
    mockPost.mockResolvedValue({
      data: {
        ticket: 'aha_join_abc123',
        expiresAt: '2026-04-02T12:34:56.000Z',
      },
    });

    await expect(createAccountJoinTicket('token-123')).resolves.toEqual({
      ticket: 'aha_join_abc123',
      expiresAt: '2026-04-02T12:34:56.000Z',
    });

    expect(mockPost).toHaveBeenCalledWith(
      'https://ahaagi.test/v1/account/join-ticket',
      {},
      {
        headers: {
          Authorization: 'Bearer token-123',
          'Content-Type': 'application/json',
        },
      },
    );
  });

  it('accepts legacy joinTicket field names for compatibility', async () => {
    mockPost.mockResolvedValue({
      data: {
        joinTicket: 'aha_join_legacy',
      },
    });

    await expect(createAccountJoinTicket('token-123')).resolves.toEqual({
      ticket: 'aha_join_legacy',
      expiresAt: null,
    });
  });

  it('throws when the server response is missing a ticket', async () => {
    mockPost.mockResolvedValue({
      data: {
        expiresAt: '2026-04-02T12:34:56.000Z',
      },
    });

    await expect(createAccountJoinTicket('token-123')).rejects.toThrow('Server did not return a join ticket');
  });

  it('surfaces a helpful error when the join code is invalid or expired', async () => {
    mockPost.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 404,
        data: {
          error: 'Join code is invalid or expired',
          code: 'JOIN_TICKET_INVALID',
        },
      },
    });

    await expect(redeemAccountJoinTicket('GHYHU3')).rejects.toThrow(
      'Join code "GHYHU3" is invalid or expired on https://ahaagi.test. Generate a fresh code with `aha auth show-join-code` on a signed-in device.',
    );
  });
});
