/**
 * Shared Zod validation schemas for MCP tool parameters.
 *
 * Centralises regex patterns so every tool that accepts an ID string
 * validates it through the same allowlist — preventing injection via
 * crafted parameter values (SEC-02 defense-in-depth).
 *
 * @module validation
 */

import { z } from 'zod';

/** Matches AHA session IDs and generic IDs (UUID-like, CUID-like, alphanumeric). */
export const sessionIdSchema = z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid sessionId format');

/** Matches task IDs from the board system. */
export const taskIdSchema = z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid taskId format');

/** Optional sessionId — when omitted the tool infers from caller metadata. */
export const optionalSessionIdSchema = sessionIdSchema.optional();

/** Matches team IDs. */
export const teamIdSchema = z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/, 'Invalid teamId format');
