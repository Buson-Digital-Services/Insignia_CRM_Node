import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { SapService } from './sap.service.js';
import type { SapIdentity } from '../common/types.js';

vi.mock('axios');

const identity: SapIdentity = {
  sapUrl: 'http://sap.example/b1s/v1/',
  sapCompanyDb: 'TestDB',
  sapUsername: 'manager',
  sapPassword: 'secret',
};

describe('SapService', () => {
  let post: ReturnType<typeof vi.fn>;
  let request: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    post = vi.fn();
    request = vi.fn();
    vi.mocked(axios.create).mockReturnValue({ post, request } as never);
  });

  it('logs in once and reuses the session cookie across calls', async () => {
    post.mockResolvedValue({ status: 200, data: { SessionTimeout: 30 }, headers: { 'set-cookie': ['B1SESSION=abc; Path=/'] } });
    request.mockResolvedValue({ status: 200, data: { value: [] } });

    const sap = new SapService();
    await sap.request(identity, 'get', "Items('A1')");
    await sap.request(identity, 'get', "Items('A2')");

    expect(post).toHaveBeenCalledTimes(1); // only one login for two calls
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][0].headers.Cookie).toBe('B1SESSION=abc');
  });

  it('throws with SAP company/username context when login fails', async () => {
    post.mockResolvedValue({ status: 401, data: { error: { message: { value: 'Invalid credentials' } } } });

    const sap = new SapService();
    await expect(sap.verifyCredentials(identity)).rejects.toThrow(/SAP login failed for TestDB\/manager/);
  });

  it('relogs in once on a 401 mid-session and retries the request', async () => {
    post
      .mockResolvedValueOnce({ status: 200, data: { SessionTimeout: 30 }, headers: { 'set-cookie': ['B1SESSION=first; Path=/'] } })
      .mockResolvedValueOnce({ status: 200, data: { SessionTimeout: 30 }, headers: { 'set-cookie': ['B1SESSION=second; Path=/'] } });
    request.mockResolvedValueOnce({ status: 401, data: {} }).mockResolvedValueOnce({ status: 200, data: { value: [] } });

    const sap = new SapService();
    const result = await sap.request(identity, 'get', "Items('A1')");

    expect(post).toHaveBeenCalledTimes(2); // initial login + relogin after 401
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0].headers.Cookie).toBe('B1SESSION=second');
    expect(result).toEqual({ value: [] });
  });

  it('throws on a non-401 error response without retrying', async () => {
    post.mockResolvedValue({ status: 200, data: { SessionTimeout: 30 }, headers: { 'set-cookie': ['B1SESSION=abc; Path=/'] } });
    request.mockResolvedValue({ status: 500, data: { error: { message: { value: 'boom' } } } });

    const sap = new SapService();
    await expect(sap.request(identity, 'get', "Items('A1')")).rejects.toThrow(/SAP Service Layer error/);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
