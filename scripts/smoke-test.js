#!/usr/bin/env node
// Loads the compiled nodes the way n8n would, checks the descriptions, and
// runs the two triggers against a stand-in for n8n's context: a signed
// delivery, a forged one, the number filter, and a polling cycle.
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const { MeisimApi } = require(path.join(dist, 'credentials', 'MeisimApi.credentials.js'));
const { Meisim } = require(path.join(dist, 'nodes', 'Meisim', 'Meisim.node.js'));
const { MeisimTrigger } = require(path.join(dist, 'nodes', 'Meisim', 'MeisimTrigger.node.js'));
const { MeisimPollTrigger } = require(path.join(dist, 'nodes', 'Meisim', 'MeisimPollTrigger.node.js'));

let n = 0;
const ok = (cond, name) => { n++; assert.ok(cond, name); };

// ── descriptions ─────────────────────────────────────────────────────────────
const cred = new MeisimApi();
ok(cred.name === 'meisimApi' && cred.authenticate.properties.headers['x-dealer-key'], 'credential sends x-dealer-key');
ok(cred.test.request.url === '/api/v1/me', 'credential test hits /api/v1/me');

const node = new Meisim().description;
ok(node.name === 'meisim' && node.credentials[0].name === 'meisimApi', 'node is wired to the credential');
const ops = node.properties.filter((p) => p.name === 'operation');
const opNames = ops.flatMap((p) => p.options.map((o) => o.value));
for (const want of ['send', 'getAll', 'update', 'renew', 'autoRenew', 'dailyStop', 'create', 'get', 'getSip', 'setWebhook', 'clearWebhook']) {
	ok(opNames.includes(want), 'operation ' + want);
}
const send = ops.find((p) => p.displayOptions.show.resource[0] === 'message').options.find((o) => o.value === 'send');
ok(/\/api\/v1\/sms\/lines\/\{\{.*\}\}\/send$/.test(send.routing.request.url) && send.routing.request.method === 'POST', 'send posts to the line');
const bodyProps = node.properties.filter((p) => p.routing && p.routing.send && p.routing.send.type === 'body').map((p) => p.routing.send.property);
ok(bodyProps.includes('to') && bodyProps.includes('message') && bodyProps.includes('count') && bodyProps.includes('webhook_url'), 'body fields route');
ok(node.properties.every((p) => !/—/.test(JSON.stringify(p))), 'no em dashes in the UI text');
for (const p of node.properties) if (p.name === 'limit') ok(p.description === 'Max number of results to return', 'limit description as n8n wants it');

// ── instant trigger ──────────────────────────────────────────────────────────
const trig = new MeisimTrigger();
ok(trig.description.webhooks[0].httpMethod === 'POST' && trig.description.polling === undefined, 'instant trigger is a webhook node');

function webhookCtx({ body, secret, signature, number = '' }) {
	const raw = JSON.stringify(body);
	let status = 0, sent = null;
	const res = { status(s) { status = s; return res; }, send(b) { sent = b; return res; } };
	const staticData = { secret };
	return {
		ctx: {
			getRequestObject: () => ({ rawBody: Buffer.from(raw), headers: { 'x-meisim-signature': signature } }),
			getResponseObject: () => res,
			getBodyData: () => body,
			getWorkflowStaticData: () => staticData,
			getNodeParameter: (name, dflt) => (name === 'number' ? number : dflt),
			helpers: { returnJsonArray: (d) => (Array.isArray(d) ? d : [d]).map((json) => ({ json })) },
		},
		result: () => ({ status, sent }),
		raw,
	};
}
const secret = 'test-secret';
const body = { event: 'sms.received', number: '2125550100', from: '3105550199', text: 'hi', received_at: '2026-10-29T20:00:00Z' };
const good = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');

(async () => {
	let c = webhookCtx({ body, secret, signature: good });
	let out = await trig.webhook.call(c.ctx);
	ok(out.workflowData && out.workflowData[0][0].json.text === 'hi', 'a signed delivery starts the workflow');

	c = webhookCtx({ body, secret, signature: good.replace(/^./, (ch) => (ch === 'a' ? 'b' : 'a')) });
	out = await trig.webhook.call(c.ctx);
	ok(out.noWebhookResponse === true && c.result().status === 401, 'a forged delivery is refused with 401');

	c = webhookCtx({ body, secret, signature: good, number: '+1 (212) 555-0100' });
	out = await trig.webhook.call(c.ctx);
	ok(out.workflowData && out.workflowData[0].length === 1, 'the number filter matches with any formatting');

	c = webhookCtx({ body, secret, signature: good, number: '2125550199' });
	out = await trig.webhook.call(c.ctx);
	ok(!out.workflowData && !out.noWebhookResponse, 'another number is acknowledged and not run');

	// webhook lifecycle against a fake API
	const api = { webhook_url: null, calls: [] };
	const hookCtx = (url) => ({
		getNodeWebhookUrl: () => url,
		getCredentials: async () => ({ apiKey: 'k', baseUrl: 'https://api.example.test/' }),
		getWorkflowStaticData: () => hookCtx.data,
		helpers: {
			httpRequestWithAuthentication: async function (_cred, opts) {
				api.calls.push(opts.method + ' ' + opts.url + ' ' + JSON.stringify(opts.body || {}));
				if (opts.method === 'GET') return { ok: true, webhook_url: api.webhook_url };
				api.webhook_url = opts.body.webhook_url || null;
				return { ok: true, webhook_url: api.webhook_url, signing_secret: api.webhook_url ? 'sec-1' : null };
			},
		},
	});
	hookCtx.data = {};
	const h = trig.webhookMethods.default;
	ok((await h.checkExists.call(hookCtx('https://n8n.test/webhook/1'))) === false, 'nothing registered yet');
	ok((await h.create.call(hookCtx('https://n8n.test/webhook/1'))) === true && hookCtx.data.secret === 'sec-1', 'create registers n8n and keeps the secret');
	ok(api.calls.some((x) => x.startsWith('POST https://api.example.test/api/v1/sms/webhook {"webhook_url":"https://n8n.test/webhook/1","format":"meisim"}')), 'create posts the n8n URL in meisim format');
	ok((await h.checkExists.call(hookCtx('https://n8n.test/webhook/1'))) === true, 'then it exists');
	api.webhook_url = 'https://elsewhere.test/hook';
	ok((await h.delete.call(hookCtx('https://n8n.test/webhook/1'))) === true && api.webhook_url === 'https://elsewhere.test/hook', 'delete leaves a webhook somebody else set');
	api.webhook_url = 'https://n8n.test/webhook/1';
	hookCtx.data = { secret: 'sec-1' };
	ok((await h.delete.call(hookCtx('https://n8n.test/webhook/1'))) === true && api.webhook_url === null && !hookCtx.data.secret, 'delete clears our own webhook and the secret');

	// ── poll trigger ───────────────────────────────────────────────────────────
	const poll = new MeisimPollTrigger();
	ok(poll.description.polling === true && !poll.description.webhooks, 'poll trigger is a polling node');
	const inbox = [
		{ id: 'm3', number: '2125550100', from: '1', text: 'three', received_at: '2026-10-29T20:03:00Z' },
		{ id: 'm2', number: '2125550100', from: '1', text: 'two', received_at: '2026-10-29T20:02:00Z' },
		{ id: 'm1', number: '2125550100', from: '1', text: 'one', received_at: '2026-10-29T20:01:00Z' },
	];
	const pollCtx = (mode) => ({
		getWorkflowStaticData: () => pollCtx.data,
		getCredentials: async () => ({ apiKey: 'k', baseUrl: 'https://api.example.test' }),
		getNodeParameter: () => '',
		getMode: () => mode,
		helpers: {
			httpRequestWithAuthentication: async function (_cred, opts) {
				pollCtx.lastQs = opts.qs;
				const since = opts.qs.since ? String(opts.qs.since) : '';
				return { ok: true, messages: inbox.filter((m) => !since || m.received_at > since) };
			},
			returnJsonArray: (d) => (Array.isArray(d) ? d : [d]).map((json) => ({ json })),
		},
	});
	pollCtx.data = {};
	let r = await poll.poll.call(pollCtx('manual'));
	ok(r && r[0].length === 3 && !pollCtx.data.lastAt, 'a manual run shows the latest texts and remembers nothing');
	r = await poll.poll.call(pollCtx('trigger'));
	ok(r === null && pollCtx.data.lastAt === '2026-10-29T20:03:00Z', 'first live poll remembers the newest and emits nothing');
	r = await poll.poll.call(pollCtx('trigger'));
	ok(r === null && pollCtx.lastQs.since === '2026-10-29T20:03:00Z', 'nothing new: asks since the newest, emits nothing');
	inbox.unshift({ id: 'm5', number: '2125550100', from: '1', text: 'five', received_at: '2026-10-29T20:05:00Z' });
	inbox.unshift({ id: 'm4', number: '2125550100', from: '1', text: 'four', received_at: '2026-10-29T20:04:00Z' });
	// keep newest-first order as the API does
	inbox.sort((a, b) => (a.received_at < b.received_at ? 1 : -1));
	r = await poll.poll.call(pollCtx('trigger'));
	ok(r && r[0].map((x) => x.json.text).join(',') === 'four,five', 'new texts come out oldest first');
	r = await poll.poll.call(pollCtx('trigger'));
	ok(r === null, 'and are not emitted twice');

	console.log(`smoke-test: ${n} checks passed`);
})().catch((e) => { console.error('smoke-test failed:', e.message); process.exit(1); });
