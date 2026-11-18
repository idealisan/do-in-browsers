/**
 * Optional Cloudflare Worker proxy for SRT / LRC Maker.
 *
 * Cloudflare's api.cloudflare.com does not send CORS headers, so a browser
 * cannot call the Workers AI REST API directly. Deploy this Worker and put
 * its URL (e.g. https://srtlrc-proxy.<subdomain>.workers.dev/whisper) into
 * the "API 地址" field in the web page.
 *
 * Deploy:
 *   npx wrangler deploy worker.js --name srtlrc-proxy
 * (or paste this file into the Cloudflare dashboard Workers editor)
 *
 * The page sends:
 *   POST /whisper
 *   X-API-Key: <Cloudflare API token>
 *   X-Account-Id: <Cloudflare account id>
 *   X-Model: @cf/openai/whisper
 *   Content-Type: audio/wav
 *   Body: raw WAV bytes
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-api-key, x-account-id, x-model',
  'Access-Control-Max-Age': '86400',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'POST') {
      return json({ success: false, errors: [{ message: 'Only POST is allowed' }] }, 405);
    }

    const token = request.headers.get('X-API-Key');
    const account = request.headers.get('X-Account-Id');
    const model = request.headers.get('X-Model') || '@cf/openai/whisper';

    if (!token || !account) {
      return json({ success: false, errors: [{ message: 'Missing X-API-Key or X-Account-Id' }] }, 400);
    }
    if (!/^[0-9a-f]{32}$/i.test(account)) {
      return json({ success: false, errors: [{ message: 'Invalid Account ID' }] }, 400);
    }
    if (!/^[a-z0-9@._/-]+$/i.test(model)) {
      return json({ success: false, errors: [{ message: 'Invalid model id' }] }, 400);
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': request.headers.get('Content-Type') || 'audio/wav',
      },
      body: request.body,
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
    });
  },
};
