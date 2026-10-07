import { describe, expect, it } from 'vitest';
import {
  checkAdminHttp,
  checkAdminWs,
  isLocalHostHeader,
  isLocalOrigin,
  isLoopbackAddress,
  type AdminRequestInfo,
} from './adminGuard.js';

const goodPost: AdminRequestInfo = {
  remoteAddress: '127.0.0.1',
  host: 'localhost:8080',
  origin: 'http://localhost:8080',
  method: 'POST',
  contentType: 'application/json',
  adminHeader: '1',
};

describe('adminGuard primitives', () => {
  it('loopback addresses', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('::1')).toBe(true);
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('192.168.0.10')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });

  it('local host header (with and without port, IPv6)', () => {
    expect(isLocalHostHeader('localhost')).toBe(true);
    expect(isLocalHostHeader('localhost:8080')).toBe(true);
    expect(isLocalHostHeader('127.0.0.1:8080')).toBe(true);
    expect(isLocalHostHeader('[::1]:8080')).toBe(true);
    expect(isLocalHostHeader('evil.com')).toBe(false);
    expect(isLocalHostHeader('localhost.evil.com')).toBe(false);
    expect(isLocalHostHeader(undefined)).toBe(false);
  });

  it('origin: absent is ok (curl), local is ok, foreign/garbage is not', () => {
    expect(isLocalOrigin(undefined)).toBe(true);
    expect(isLocalOrigin('http://localhost:8080')).toBe(true);
    expect(isLocalOrigin('http://127.0.0.1:8080')).toBe(true);
    expect(isLocalOrigin('http://[::1]:8080')).toBe(true);
    expect(isLocalOrigin('https://evil.com')).toBe(false);
    expect(isLocalOrigin('http://localhost.evil.com')).toBe(false);
    expect(isLocalOrigin('null')).toBe(false);
  });
});

describe('checkAdminHttp', () => {
  it('accepts a well-formed local POST', () => {
    expect(checkAdminHttp(goodPost)).toEqual({ ok: true });
  });

  it('accepts a local GET without POST-only requirements', () => {
    expect(
      checkAdminHttp({ ...goodPost, method: 'GET', contentType: undefined, adminHeader: undefined }),
    ).toEqual({ ok: true });
  });

  it('rejects remote IP (other machine on the LAN)', () => {
    expect(checkAdminHttp({ ...goodPost, remoteAddress: '192.168.0.20' }).ok).toBe(false);
  });

  it('rejects DNS rebinding (foreign Host header)', () => {
    expect(checkAdminHttp({ ...goodPost, host: 'attacker.com:8080' }).ok).toBe(false);
  });

  it('rejects cross-site Origin (CSRF from another website)', () => {
    expect(checkAdminHttp({ ...goodPost, origin: 'https://evil.com' }).ok).toBe(false);
  });

  it('rejects POST without JSON content-type or without X-Admin', () => {
    expect(checkAdminHttp({ ...goodPost, contentType: 'text/plain' }).ok).toBe(false);
    expect(checkAdminHttp({ ...goodPost, contentType: undefined }).ok).toBe(false);
    expect(checkAdminHttp({ ...goodPost, adminHeader: undefined }).ok).toBe(false);
    expect(checkAdminHttp({ ...goodPost, adminHeader: '0' }).ok).toBe(false);
  });
});

describe('checkAdminWs', () => {
  it('accepts local, rejects remote / foreign host / foreign origin', () => {
    const base = { remoteAddress: '::1', host: 'localhost:8787', origin: 'http://localhost:8080' };
    expect(checkAdminWs(base).ok).toBe(true);
    expect(checkAdminWs({ ...base, remoteAddress: '10.0.0.5' }).ok).toBe(false);
    expect(checkAdminWs({ ...base, host: 'x.com' }).ok).toBe(false);
    expect(checkAdminWs({ ...base, origin: 'https://evil.com' }).ok).toBe(false);
  });
});
