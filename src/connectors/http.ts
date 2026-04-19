/**
 * Minimal HTTP client using Node built-ins (https module).
 * Replaces axios for environments where npm packages are unavailable.
 * Supports Bearer auth, JSON body, retries with exponential backoff.
 */
import https from 'https';
import http from 'http';
import { URL } from 'url';

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  data: T;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

function request<T>(urlStr: string, opts: RequestOptions = {}): Promise<HttpResponse<T>> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const body = opts.body ? JSON.stringify(opts.body) : undefined;
    const reqOpts: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: opts.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}),
        ...opts.headers,
      },
    };
    const req = lib.request(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        let data: T;
        try { data = JSON.parse(raw); } catch { data = raw as unknown as T; }
        resolve({ status: res.statusCode ?? 0, headers: res.headers as Record<string, string | string[] | undefined>, data });
      });
    });
    req.on('error', reject);
    if (opts.timeout) req.setTimeout(opts.timeout, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function requestWithRetry<T>(url: string, opts: RequestOptions, retries = 3, delayMs = 500): Promise<HttpResponse<T>> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await request<T>(url, opts);
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delayMs * Math.pow(2, i)));
    }
  }
  throw new Error('Max retries exceeded');
}

export class HttpClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor(baseUrl: string, headers: Record<string, string> = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.defaultHeaders = headers;
  }

  setHeader(key: string, value: string) { this.defaultHeaders[key] = value; }

  private url(path: string): string {
    return path.startsWith('http') ? path : `${this.baseUrl}${path}`;
  }

  async get<T>(path: string, extraHeaders: Record<string, string> = {}): Promise<HttpResponse<T>> {
    return requestWithRetry<T>(this.url(path), { method: 'GET', headers: { ...this.defaultHeaders, ...extraHeaders } });
  }

  async post<T>(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<HttpResponse<T>> {
    return requestWithRetry<T>(this.url(path), { method: 'POST', body, headers: { ...this.defaultHeaders, ...extraHeaders } });
  }

  async patch<T>(path: string, body: unknown): Promise<HttpResponse<T>> {
    return requestWithRetry<T>(this.url(path), { method: 'PATCH', body, headers: this.defaultHeaders });
  }
}
