// Preloaded only by tests. Never delegates to a real network implementation.
import { appendFileSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const record = (entry) => appendFileSync(process.env.HALLMARK_TEST_TRACE, JSON.stringify(entry) + '\n');
const deny = () => {
  record({ forbidden: true });
  throw new Error('Real network access is forbidden in imagegen tests');
};
http.request = http.get = https.request = https.get = deny;
net.connect = net.createConnection = tls.connect = deny;
net.Socket.prototype.connect = deny;
syncBuiltinESMExports();
globalThis.fetch = async (url, options) => {
  record({ url, method: options?.method, body: JSON.parse(options?.body ?? '{}') });
  if (!process.env.HALLMARK_TEST_RESPONSE) throw new Error('Unexpected fetch in offline test');
  if (url !== 'https://api.together.xyz/v1/images/generations' || options?.method !== 'POST') {
    throw new Error('Unexpected provider request');
  }
  const images = JSON.parse(readFileSync(process.env.HALLMARK_TEST_RESPONSE, 'utf8'));
  return { ok: true, json: async () => ({ data: images.map(b64_json => ({ b64_json })) }) };
};
